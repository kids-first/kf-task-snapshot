'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request-promise');
//const S3 = require('aws-sdk/clients/s3');

const logErrors = require('./middlewares/errorHandler');


const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(logErrors);

app.get('/status', (req, res) => {
    return res.status(200).json({ 
        message: {
            name: SERVICE_NAME,
            version: '1.0.0'
        }
    });
});
app.post('/tasks', (req, res) => {
    let body = req.body;
    if(body.body !== undefined) {
        body = body.body;
    }

    const action = body.action;
    const taskId = body.task_id;
    const releaseId = body.release_id;
    let message;

    if (
        action === undefined
        || taskId === undefined
        || releaseId === undefined
    ) {
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

    let task = getTask(taskId);
    if (task === undefined && action !== 'initialize') {
        return res.status(400).json({ 
            message: `${taskId} does not exist. Please initialize it`
        });
    }

    const state = task !== undefined ? task.state : undefined;
    let isAllowed = TRANSITIONS[state] === action;
    isAllowed = isAllowed || action === 'get_status';
    if (isAllowed === false) {
        return res.status(400).json({ 
            message: `${action} is not allowed on task in state ${state}`
        });
    }

    if (action !== 'get_status' && action !== 'initialize') {
        return ACTIONS[action](taskId, releaseId, res);
    }

    if (task === undefined && action === 'initialize') {
        initialize(taskId, releaseId);
        task = getTask(taskId);        
    }

    // Handle get_status and cancel
    return res.status(200).json({ body: task });
});

app.listen(port, (err) => {
    if (err) {
        return err;
    }

    console.log(`Server listening on ${port}`);
});

// Task information cache
const tasks = {};

// Snapshot cache
const snapshot = {};

// Constants
var DATA_SERVICE_API = 'localhost:1080';
var ENDPOINTS = {
    study: '/studies',
    participant: '/participants',
    diagnosis: '/diagnoses',
    phenotype: '/phenotypes',
    outcome: '/outcomes',
    sequencing_center: '/sequecing-centers',
    biospecimen: '/biospecimens',
    genomic_file: '/genomic-files'
};
var COORDINATOR_API = 'localhost:8000';
var TRANSITIONS = {
    undefined: 'initialize',
    pending: 'start',
    staged: 'publish'
};

/** 
 * @access public
 * initialize() creates a new task of snapshot
 * @param {string} taskId 
 * @param {string} releaseId 
 */
const initialize = (taskId, releaseId) => {
    const data = {
        name: SERVICE_NAME,
        date_submitted: new Date(),
        progress: null,
        task_id: taskId,
        release_id: releaseId,
        state: 'pending'
    };
    updateState(taskId, data);
};

/** 
 * @access public
 * start() processes a snapshot task
 * @param {string} taskId 
 * @param {string} releaseId 
 */

const start = (taskId, releaseId, context) => {
    let data = { state: 'running' };
    updateState(taskId, data);
    let task = getTask(taskId); 

    context.status(200).json({ body: task });

    let next;
    Promise.resolve(() => {
        for (let endpoint in ENDPOINTS) {
            next = endpoint;
            while (next) {
                request.get({
                    uri: DATA_SERVICE_API + next,
                    qs: { limit: 100 },
                    json: true
                }).then((res) => {
                    const { results, _links } = res;
                    snapshot[endpoint] = (snapshot[endpoint] || []).concat(results);
                    next = res._links.next;
                }).catch(err => {
                    console.error(err.message);
                    //cancel()
                });
            }

        }
    }).then(() => {
        data = { progress: 100, state: 'staged' }
        request.patch({
            uri: `${COORDINATOR_API}/releases/${releaseId}/tasks/${taskId}`,
            body: data,
            json: true
        }).then((res) => {
            data.state = 'staged';
            updateState(taskId, data);
        }).catch((err) => {
            data.state = 'pending';
            data.err = err.message;
            updateState(taskId, data);
        });
    });
};

/** 
 * @access public
 * publish() publishes a staged snapshot task
 * @param {string} taskId 
 * @param {string} releaseId 
 */
const publish = (taskId, releaseId) => {
    const data = { state: 'publishing' };
    updateState(taskId, data);

    // tar with Promise
    next();

    request.patch(
        `http://localhost:8000/tasks/${taskId}`,
        { json: { progress: 100, state: 'published' } },
        (err, res) => {
            if (res.statusCode !== 200) {
                data.state = 'staged';
                data.err = err.message;
            } else {
                data.state = 'published';
            }
            updateState(taskId, data);
        }
    )
};

/** 
 * @access public
 * cancel() terminates a snapshot task
 * @param {string} taskId 
 * @param {string} releaseId 
 */
const cancel = (taskId, releaseId) => {
    const data = { state: 'cancelled' };
    updateState(taskId, data);
};

/** 
 * @access public
 * getStatus() returns a status of snapshot task
 * @param {string} taskId 
 * @returns {Object}
 */
const getStatus = (taskId) => {
    return getTask(taskId);
};

/** 
 * @access private
 * getTask() returns snapshot task information
 * @param {string} taskId 
 * @returns {Object}
 */
const getTask = (taskId) => {
    /**
     * const sql = `SELECT * FROM task WHERE taskId = ${taskId}`;
     * db.get(sql, (err, row) => {
     *  if (err) {
     *      return console.error(err.message);
     *  }
     * 
     *  return row;
     * });
     */
    return tasks[taskId];
};

/** 
 * @access private
 * updateState() updates a state of snapshot task
 * @param {string} taskId 
 * @param {Object} body
 */
const updateState = (taskId, body) => {
    let task = getTask(taskId);
    if (task === undefined) {
        task = {};
    }

    // Refactor with forEach and Promise
    for (let key in body) {
        task[key] = body[key];
    }
    tasks[taskId] = task;
};

// Routing logic
var ACTIONS = {
    initialize: initialize,
    start: start,
    publish: publish,
    get_status: getStatus,
    cancel: cancel
};
var SERVICE_NAME = 'Snapshot Task';
var BUCKET = '';