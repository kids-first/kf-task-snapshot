'use strict';

const fs = require('fs');

const express = require('express');
const dotenv = require('dotenv');
const request = require('request-promise');
const tar = require('tar');
const S3 = require('aws-sdk/clients/s3');


const router = express.Router();
dotenv.config();

router.post('/', (req, res) => {
    const { action, task_id, release_id } = req.body;

    if (!action || !task_id || !release_id) {
        return res.status(400).json({ 
            message: 'missing a required field'
        });
    }

    if (ACTIONS[action] === undefined) {
        const actions = Object.keys(ACTIONS).join(', ');
        return res.status(400).json({ 
            message: `action must be one of: ${actions}`
        });
    }

    let task = getTask(task_id);
    if (task === undefined && action !== 'initialize') {
        return res.status(400).json({ 
            message: `${task_id} not found. Initialize it`
        });
    }

    const state = task !== undefined ? task.state : undefined;
    let isAllowed = TRANSITIONS[state] === action;
    isAllowed = isAllowed || action === 'get_status';
    if (isAllowed === false) {
        return res.status(400).json({ 
            message: `${action} not allowed in ${state}`
        });
    }

    if (action !== 'get_status' && action !== 'initialize') {
        ACTIONS[action](task_id, release_id, res);
    }
    
    if (task === undefined && action === 'initialize') {
        initialize(task_id, release_id);
        return res.status(200).json(getTask(task_id));  
    }

    return res.status(200).json(get_status(task_id));
});

// Task cache
const tasks = {};

// Snapshot cache
const snapshot = {};

// Constants
const DATA_SERVICE_API = process.env.DATA_SERVICE_API;
const ENDPOINTS = {
    study: '/studies',
    participant: '/participants',
    biospecimen: '/biospecimens',
    diagnosis: '/diagnoses',
    phenotype: '/phenotypes',
    outcome: '/outcomes',
    sequencing_center: '/sequencing-centers',
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
 * isSomeUndefined() checks if at least one element is undefined
 * @param {premitive(s)} ...args
 * @returns {boolean} 
 */
const isSomeUndefined = (...args) => {
    return args.some((ele) => { return ele === undefined; });
}

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
 * start() starts the creation of snapshot
 * @param {string} task_id
 * @param {string} release_id
 * @param {Object} context
 * @returns {Object}
 */
const start = (task_id, release_id, context) => {
    updateState(task_id, { state: 'running' });
    context.status(200).json(getTask(task_id));

    Promise.resolve(() => {
        let studyIds = [];
        for (let endpoint in ENDPOINTS) {
            let next = endpoint;
            const options = {
                uri: DATA_SERVICE_API + next,
                qs: { limit: 100 },
                json: true
            };

            if (endpoint !== 'study') {
                for (let studyId of studyIds) {
                    options.study_id = studyId;
                    while (next) {
                        request.get(options).then((res) => {
                            const { results, _links } = res;
                            snapshot[studyId] = snapshot[studyId] || {};
                            snapshot[studyId][endpoint] = (
                                snapshot[studyId][endpoint] || []
                            ).concat(results);
                            next = res._links.next;
                        }).catch((err) => {
                            updateState(task_id, { state: 'failed'});
                            console.error(err.message);
                        });
                    }
                }
            } else {
                while (next) {
                    request.get(options).then((res) => {
                        const { results, _links } = res;
                        for (let result of results) {
                            studyIds.push(result.kf_id);
                        }
                        next = res._links.next;
                    }).catch((err) => {
                        updateState(task_id, { state: 'failed'});
                        console.error(err.message);
                    });
                }
            }
        }
    }).then(() => {
        request.patch({
            uri: `${COORDINATOR_API}/releases/${release_id}/tasks/${task_id}`,
            body: { progress: 100, state: 'staged' },
            json: true
        }).then((res) => {
            updateState(task_id, { state: 'staged' });
        }).catch((err) => {
            updateState(task_id, { state: 'pending' });
            console.error(err.message);
        });
    });
};

/** 
 * @access public
 * publish() publishes a staged snapshot task
 * @param {string} task_id 
 * @param {string} release_id
 * @param {Object} context
 * @returns {Object}
 */
const publish = (taskId, releaseId, context) => {
    updateState(taskId, { state: 'publishing' });
    context.status(200).json(getTask(task_id));

    let file = `${release_id}.json`; 
    const data = JSON.stringify(snapshot);
    fs.writeFile(file, data, 'utf-8', (err) => {
        if (err) {
            updateState(task_id, { state: 'failed' });
            console.error(err.message);
        }

        let options = { file: `${release_id}.tar.gz` }
        tar.c(options, [file], (err) => {
            if (err) {
                updateState(task_id, { state: 'failed' });
                console.error(err.message);
            }

            file = options.file;
            fs.readFile(file, (err, data) => {
                if (err) {
                    updateState(task_id, { state: 'failed' });
                    console.error(err.message);
                }

                const params = { Bucket: BUCKET };
                const s3 = new S3(params);
    
                Object.assign(params, { Key: file, Body: data});
                s3.putObject(params, (err) => {
                    if (err) {
                        updateState(task_id, { state: 'failed' });
                        console.error(err.message);
                    }

                    request.patch({
                        uri: `${COORDINATOR_API}/releases/${release_id}/tasks/${task_id}`,
                        body: { progress: 100, state: 'published' },
                        json: true
                    }).then((res) => {
                        if (res.statusCode !== 200) {
                            updateState(taskId, { state: 'staged' });
                        } else {
                            updateState(taskId, { state: 'published' });
                        }
                    }).catch((err) => {
                        console.error(err.message);
                    });
                });
            });
        })
    });
};

/** 
 * @access public
 * cancel() terminates a snapshot task
 * @param {string} task_id 
 * @param {string} release_id 
 * @param {Object} context
 * @returns {Object}
 */
const cancel = (task_id, release_id, context) => {
    updateState(task_id, { state: 'cancelled' });
    return context.status(200).json({
        message: `task ${task_id} is cancelled`
    })
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
    
    //Object.assign(task, body)
    for (let key in body) { 
        task[key] = body[key]; 
    }

    tasks[task_id] = task;
};

// Routing logic
const ACTIONS = {
    initialize,
    start,
    publish,
    get_status,
    cancel
};

module.exports = router;