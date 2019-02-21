const express = require('express');
const request = require('request');
const AWS = require('aws-sdk');

const ENDPOINTS = require('../config/endpoint');


AWS.config.update({ region: 'us-east-1' });
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const router = express.Router();
require('dotenv').config();

router.post('/', async (req, res) => {
  const { action, task_id, release_id } = req.body;

  // if any of the params misses, return 400
  if (!action || !task_id || !release_id) {
    return res.status(400).json({
      message: 'missing a required field',
    });
  }

  // if an action is not pre-defined, return 400
  if (ACTIONS[action] === undefined) {
    const actions = Object.keys(ACTIONS).join(', ');
    return res.status(400).json({
      message: `action must be one of: ${actions}`,
    });
  }

  // if a task is not initialized, return 400
  const task = await getTask(task_id);
  if (task === undefined && action !== 'initialize') {
    return res.status(400).json({
      message: `${task_id} not found. Initialize it`,
    });
  }

  // if an action is not allowed, return 400
  const state = task !== undefined ? task.state : task;
  let isAllowed = TRANSITIONS[state] === action;
  isAllowed = (isAllowed
    || ['get_status', 'cancel'].indexOf(action) > -1);
  if (isAllowed === false) {
    return res.status(400).json({
      message: `${action} not allowed in ${state}`,
    });
  }

  // initialize a task
  if (task === undefined && action === 'initialize') {
    await initialize(task_id, release_id);
    return res.status(200).json(await getTask(task_id));
  }

  // trigger start(), publish(), or cancel()
  if (['initialize', 'get_status'].indexOf(action) < 0) {
    const data = {};
    switch (action) {
      case 'start': {
        data.state = 'running';
        break;
      }
      case 'publish': {
        data.state = 'publishing';
        break;
      }
      case 'cancel': {
        data.state = 'cancelling';
        break;
      }
      // no default
    }

    await updateState(task_id, data);
    ACTIONS[action](task_id, release_id);
  }

  // return the status of task
  return res.status(200).json(await get_status(task_id));
});

// declare a snapshot cache
let snapshot;

// define constants
const {
  DATASERVICE_API,
  COORDINATOR_API,
  TABLE_NAME,
  SNAPSHOT_BUCKET,
} = process.env;
const TRANSITIONS = {
  undefined: 'initialize',
  pending: 'start',
  staged: 'publish',
};
const REQUEST_OPTIONS = {
  release: {
    uri: '/releases',
    baseUrl: COORDINATOR_API,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  },
  data: {
    baseUrl: DATASERVICE_API,
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    qs: { limit: 100, visible: true },
  },
  patch: {
    uri: '/tasks',
    baseUrl: COORDINATOR_API,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: { progress: 100, state: null },
    json: true,
  },
};

/**
 * @access public
 * initialize() creates a new task of snapshot
 * @param {string} task_id
 * @param {string} release_id
 */
const initialize = (task_id, release_id) => {
  const data = {
    task_id,
    release_id,
    name: 'snapshot task',
    date_submitted: getISOString(new Date()),
    progress: null,
    state: 'pending',
  };

  // initialize a snapshot cache
  snapshot = {};

  // update task in DynamoDB to pending
  return updateState(task_id, data);
};

/**
 * @access private
 * getISOString() converts a Date object to an ISO string
 * @param {Object} date
 * @returns {string}
 */
const getISOString = (date) => {
  const checkDigit = (num) => {
    return (num < 10 ? '0' : '') + num;
  };

  return `${date.getUTCFullYear()}-`
    + `${checkDigit(date.getUTCMonth() + 1)}-`
    + `${checkDigit(date.getUTCDate())}T`
    + `${checkDigit(date.getUTCHours())}:`
    + `${checkDigit(date.getUTCMinutes())}:`
    + `${checkDigit(date.getUTCSeconds())}Z`;
};

/**
 * @access public
 * start() triggers the creation of snapshot
 * @param {string} task_id
 * @param {string} release_id
 * @returns {Object}
 */
const start = (task_id, release_id) => {
  const releaseOptions = { ...REQUEST_OPTIONS.release };
  releaseOptions.uri += `/${release_id}`;

  requestAsync(releaseOptions)
    .then(({ res, body }) => {
      // get study IDs in a given release
      return JSON.parse(body).studies;
    })
    .then((studies) => {
      // get and store entities by study
      return Promise.all(studies.map((study) => {
        const dataOptions = { ...REQUEST_OPTIONS.data };
        return scrapeByStudy(dataOptions, study);
      }));
    })
    .then((studies) => {
      // put objects in S3 by study and entity
      return Promise.all(studies.map((study) => {
        return createSnapshot(release_id, study);
      }));
    })
    .then((studies) => {
      // patch task in release coordinator to staged
      console.log(`STAGED: ${studies.join(', ')}`);

      const patchOptions = { ...REQUEST_OPTIONS.patch };
      patchOptions.uri += `/${task_id}`;
      patchOptions.body.state = 'staged';

      return requestAsync(patchOptions);
    })
    .then(() => {
      // update task in DynamoDB to staged
      updateState(task_id, { state: 'staged' });
    })
    .catch((err) => {
      // update task in DynamoDB to failed
      updateState(task_id, { state: 'failed' });
      console.log(err.message);
    })
    .finally(() => {
      // flush out when either staged or failed
      snapshot = {};
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
const loopRequest = (options, link, array) => {
  options.uri = link;
  return new Promise((resolve, reject) => {
    requestAsync(options)
      .then(({ res, body }) => {
        const data = JSON.parse(body);
        // handles a 404 response
        if (data._status.code === 404) resolve(array);

        let { results } = data;
        results = array.concat(results);
        const { next } = data._links;
        if (next === undefined) resolve(results);
        else resolve(loopRequest(options, next, results));
      })
      .catch((err) => { reject(err); });
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
      const entity = entry[0];
      let endpoint = entry[1];
      if (entity === 'study') endpoint += `/${study}`;
      else options.qs.study_id = study;

      loopRequest(options, endpoint, [])
        .then((results) => {
          snapshot[study][entity] = results;
          const size = snapshot[study][entity].length;
          console.log(`DONE: ${size} ${entity} of ${study}`);
          count -= 1;
          if (count <= 0) resolve(study);
        })
        .catch((err) => { reject(err); });
    });
  });
};

/**
 * @access private
 * createSnapshot() creates a snapshot by study and entity
 * @param {string} release_id
 * @param {string} study
 * @returns {Object}
 */
const createSnapshot = (release_id, study) => {
  return new Promise((resolve, reject) => {
    console.log(`START: creating ${study}`);

    const entries = Object.entries(snapshot[study]);
    let count = entries.length;
    entries.forEach((entry) => {
      const [entity, data] = entry;
      putObjectAsync({
        Bucket: SNAPSHOT_BUCKET,
        Key: `${release_id}/${study}/dataservice/${entity}.json`,
        Body: JSON.stringify(data),
        ContentType: 'application/json',
      })
        .then((body) => {
          console.log(`DONE: ${body}`);
          count -= 1;
          if (count <= 0) resolve(study);
        })
        .catch((err) => { reject(err); });
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
    console.log(`putting ${params.Key} into ${params.Bucket}`);
    s3.putObject(params, (err, body) => {
      if (err) reject(err);
      else resolve(body);
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
  const releaseOptions = { ...REQUEST_OPTIONS.release };
  releaseOptions.uri += `/${release_id}`;

  requestAsync(releaseOptions)
    .then(({ res, body }) => {
      // get study IDs in a given release
      return JSON.parse(body).studies;
    })
    .then((studies) => {
      // TODO: add a proper publishing function
      return next(studies);
    })
    .then((studies) => {
      // patch task in release coordinator to published
      console.log(`PUBLISHED: ${studies.join(', ')}`);

      const patchOptions = { ...REQUEST_OPTIONS.patch };
      patchOptions.uri += `/${task_id}`;
      patchOptions.body.state = 'published';

      return requestAsync(patchOptions);
    })
    .then(() => {
      // update task in DynamoDB to published
      updateState(task_id, { state: 'published' });
    })
    .catch((err) => {
      // update task in DynamoDB to failed
      updateState(task_id, { state: 'failed' });
      console.log(err.message);
    });
};

/**
 * @access private
 * next() is a placeholding function
 * @param {Object[]} array
 * @returns {Object}
 */
const next = (array) => { return array; };

/**
 * @access public
 * cancel() terminates a snapshot task
 * @param {string} task_id
 * @param {string} release_id
 * @returns {Object}
 */
const cancel = async (task_id, release_id) => {
  // flush out the snapshot cache
  snapshot = {};
  await updateState(task_id, { state: 'cancelled' });
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
const getTask = (task_id) => {
  const params = {
    TableName: TABLE_NAME, Key: { task_id },
  };

  return new Promise((resolve, reject) => {
    docClient.get(params, (err, body) => {
      if (err) reject(err);
      else resolve(body.Item);
    });
  });
};

/**
 * @access private
 * updateState() updates a state of snapshot task
 * @param {string} task_id
 * @param {Object} data
 */
const updateState = async (task_id, data) => {
  const task = await getTask(task_id);
  const params = { TableName: TABLE_NAME };

  if (!task) {
    return new Promise((resolve, reject) => {
      params.Item = data;
      docClient.put(params, (err, body) => {
        if (err) reject(err);
        else resolve(body);
      });
    });
  }

  return new Promise((resolve, reject) => {
    params.Key = { task_id };
    params.UpdateExpression = 'set #state = :s';
    params.ExpressionAttributeNames = {
      '#state': 'state',
    };
    params.ExpressionAttributeValues = {
      ':s': data.state,
    };
    docClient.update(params, (err, body) => {
      if (err) reject(err);
      else resolve(body);
    });
  });
};

// routing logic
const ACTIONS = {
  initialize, start, publish, get_status, cancel,
};

module.exports = router;
