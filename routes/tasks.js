'use strict';

const fs = require('fs');

const express = require('express');
const request = require('request');
const S3 = require('aws-sdk/clients/s3');

const router = express.Router();
require('dotenv').config();

router.post('/', (req, res) => {
    const { action, task_id, release_id } = req.body;

    // if any of the params misses, return 400
    if (!action || !task_id || !release_id) {
        return res.status(400).json({ 
            message: 'missing a required field'
        });
    }

    // if an action is not prediefined, return 400
    if (ACTIONS[action] === undefined) {
        const actions = Object.keys(ACTIONS).join(', ');
        return res.status(400).json({ 
            message: `action must be one of: ${actions}`
        });
    }

    // if a task is not initialized, return 400
    let task = getTask(task_id);
    if (task === undefined && action !== 'initialize') {
        return res.status(400).json({ 
            message: `${task_id} not found. Initialize it`
        });
    }

    // if an action is not allowed, return 400
    const state = task !== undefined ? task.state : task;
    let isAllowed = TRANSITIONS[state] === action;
    isAllowed = (isAllowed || 
        ['get_status', 'cancel'].indexOf(action) > -1);
    if (isAllowed === false) {
        return res.status(400).json({ 
            message: `${action} not allowed in ${state}`
        });
    }

    // initialize a task
    if (task === undefined && action === 'initialize') {
        initialize(task_id, release_id);
        return res.status(200).json(getTask(task_id));  
    }

    // trigger start(), publish(), and cancel()
    if (['initialize', 'get_status'].indexOf(action) < 0) {
        ACTIONS[action](task_id, release_id);
    }

    // return the status of task
    return res.status(200).json(get_status(task_id));
});

// define a task cache
const tasks = {};

// define a snapshot cache
const snapshot = {};

// define constants
const DATASERVICE_API = process.env.DATASERVICE_API;
const ENDPOINTS = {
    study: '/studies',
    participant: '/participants',
    diagnosis: '/diagnoses',
    phenotype: '/phenotypes',
    outcome: '/outcomes',
    biospecimen: '/biospecimens',
    sequencing_center: '/sequencing-centers',
    sequencing_experiment: 'sequencing-experiments',
    genomic_file: '/genomic-files'
};
const COORDINATOR_API = process.env.COORDINATOR_API;
const TRANSITIONS = {
    undefined: 'initialize',
    pending: 'start',
    staged: 'publish'
};
const BUCKET = process.env.BUCKET;

/** 
 * @access public
 * initialize() creates a new task of snapshot
 * @param {string} task_id 
 * @param {string} release_id 
 */
const initialize = (task_id, release_id) => {
    const data = {
        name: 'snapshot task',
        date_submitted: new Date(),
        progress: null,
        task_id,
        release_id,
        state: 'pending'
    };
    updateState(task_id, data);
};

/** 
 * @access public
 * start() triggers the creation of snapshot
 * @param {string} task_id
 * @param {string} release_id
 * @returns {Object}
 */
const start = (task_id, release_id) => {
    updateState(task_id, { state: 'running' });

    const options = {
        release: {
            uri: `/releases/${release_id}`,
            baseUrl: COORDINATOR_API,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        },
        data: {
            baseUrl: DATASERVICE_API,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            qs: { limit: 100 }
        },
        patch: {
            uri: `/tasks/${task_id}`,
            baseUrl: COORDINATOR_API,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: { progress: 100, state: 'staged' },
            json: true
        }
    };

    requestAsync(options.release)
        .then(({ res, body }) => {
            return JSON.parse(body).studies;
        })
        .then((studies) => {
            return Promise.all(studies.map((study) => {
                return scrapeByStudy(options.data, study);
            }));
        })
        .then((results) => {
            console.log(`STAGED: ${results}`);
            return requestAsync(options.patch);
        })
        .then(() => {
            updateState(task_id, { state: 'staged' });
        })
        .catch((err) => {
            updateState(task_id, { state: 'failed'});
            console.log(err.message);
        });
};

/** 
 * @access private
 * requestAsync() sends a promisified request
 * @param {Object} options
 * @returns {Object}
 */
const requestAsync = (options) => {
    return new Promise((resolve, reject) => {
        request(options, (err, res, body) => {
            if (err) reject(err);
            else resolve({ res, body });
        });
    });
};

/** 
 * @access private
 * loopRquest() paginates and saves the results
 * @param {Object} options
 * @param {string} next
 * @param {Object[]} array
 * @returns {Object}
 */
const loopRequest = (options, next, array) => {
    options.uri = next;
    return new Promise((resolve, reject) => {
        requestAsync(options)
            .then(({ res, body }) => {
                const data = JSON.parse(body);
                const { _links, results } = data;
                array = array.concat(results);
                next = _links.next;
                if (next === undefined) resolve(array);
                else resolve(
                    loopRequest(options, next, array)
                );
            })
            .catch((err) => { reject(err) });
    });
};

/** 
 * @access private
 * scrapeByStudy() collects data by study
 * @param {Object} options
 * @param {Object} study
 * @returns {string}
 */
const scrapeByStudy = (options, study) => {
    return new Promise((resolve, reject) => {
        console.log(`START: scraping ${study}`);

        snapshot[study] = {};
        const entries = Object.entries(ENDPOINTS);
        let count = entries.length;
        entries.forEach((entry) => {
            let [endpoint, next] = entry;
            const data = [];
            if (endpoint === 'study') {
                next += `/${study}`;
            } else {
                options.qs.study_id = study;
            }
            
            loopRequest(options, next, data)
                .then((data) => {
                    snapshot[study][endpoint] = data;
                    console.log(
                        `DONE: ${endpoint} of ${study}`
                    );
                    if (--count <= 0) resolve(study);
                })
                .catch((err) => { reject(err); });
        });
    });
};

/** 
 * @access public
 * publish() publishes a staged snapshot task
 * @param {string} task_id 
 * @param {string} release_id
 * @returns {Object}
 */
const publish = (task_id, release_id) => {
    updateState(task_id, { state: 'publishing' });

    const file = `${release_id}.json`; 
    const options = {
        patch: {
            uri: `/tasks/${task_id}`,
            baseUrl: COORDINATOR_API,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: { progress: 100, state: 'published' },
            json: true
        },
        rs: { encoding: 'utf-8' }
    };

    writeFileAsync(file, JSON.stringify(snapshot))
        .then(() => {
            return putObjectAsync({
                Bucket: BUCKET, 
                Key: file,
                Body: fs.createReadStream(file, options.rs)
            });
        })
        .then(() => {
            console.log(`Successfully uploaded ${file}`);
            return requestAsync(options.patch);
        })
        .then(() => {
            updateState(task_id, { state: 'published' });
        })
        .catch((err) => {
            updateState(task_id, { state: 'failed'});
            console.log(err.message);
        });
};

/** 
 * @access private
 * writeFileAsync() writes data on a local disk
 * @param {string} file
 * @param {Object} data
 * @returns {Object}
 */
const writeFileAsync = (file, data) => {
    return new Promise((resolve, reject) => {
        console.log(`writing data to ${file}`);
        fs.writeFile(file, data, (err) => {
            if (err) reject (err);
            else resolve();
        });
    });
};

/** 
 * @access private
 * putObjectAsync() put data in an S3 bucket
 * @param {Object} params
 * @returns {Object}
 */
const putObjectAsync = (params) => {
    return new Promise((resolve, reject) => {
        console.log(
            `putting ${params.Key} into ${params.Bucket}`
        );
        const s3 = new S3();
        s3.putObject(params, (err, body) => {
            if (err) reject(err);
            else resolve(body);
        });
    });
};

/** 
 * @access public
 * cancel() terminates a snapshot task
 * @param {string} task_id 
 * @param {string} release_id 
 * @returns {Object}
 */
const cancel = (task_id, release_id) => {
    updateState(task_id, { state: 'cancelled' });
};

/** 
 * @access public
 * get_status() returns a status of snapshot task
 * @param {string} task_id 
 * @returns {Object}
 */
const get_status = (task_id) => { return getTask(task_id); };

/** 
 * @access private
 * getTask() returns snapshot task information
 * @param {string} task_id 
 * @returns {Object}
 */
const getTask = (task_id) => { return tasks[task_id]; };

/** 
 * @access private
 * updateState() updates a state of snapshot task
 * @param {string} task_id 
 * @param {Object} body
 */
const updateState = (task_id, body) => {
    let task = getTask(task_id);
    task = task === undefined ? {} : task;
    Object.assign(task, body);
    tasks[task_id] = task;
};

// routing logic
const ACTIONS = {
    initialize,
    start,
    publish,
    get_status,
    cancel
};

module.exports = router;