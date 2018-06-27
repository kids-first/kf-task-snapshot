'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const S3 = require('aws-sdk/clients/s3');


const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/status', (req, res) => {
    res.status(200).json({
        'name': 'Snapshot Task',
        'message': 'ready for work',
        'version': '1.0.0'
    });
});
app.post('/tasks', (req, res) => {
    next()
});

app.listen(port, (err) => {
    if (err) {
        return err;
    }
    
    console.log(`Server listening on ${port}`);
});

/** 
 * @access public
 * initialize() creates a new task of snapshot
 * @param {string} taskId 
 * @param {string} releaseId 
 */
const initialize = (taskId, releaseId) => {
    body = {
        'name': 'Snapshop Task',
        'date_submitted': new Date(),
        'task_id': taskId,
        'release_id': releaseId,
        'state': 'pending'
    }

    updateState(taskId, body);
};

/** 
 * @access public
 * getStatus() returns a task status
 * @param {string} taskId 
 */
const getStatus = (taskId) => {
    return getTask(taskId);
};

/** 
 * @access private
 * getTask() returns 
 * @param {string} taskId 
 */
const getTask = (taskId) => {
    return 
};

/** 
 * @access private
 * updateState() returns an update state of task
 * @param {string} taskId 
 * @param {Object} body
 */
const updateState = (taskId, body) => {
    return 
};