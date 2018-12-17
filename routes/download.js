const { Readable } = require('stream');

const express = require('express');
const AWS = require('aws-sdk');
const zlib = require('zlib');


AWS.config.update({ region: 'us-east-1' });
const s3 = new AWS.S3();

const router = express.Router();
require('dotenv').config();

// handles when missing release_id
router.get('/', (req, res) => {
  return res.status(400).json({
    message: 'missing a required field',
  });
});

// handles single release/study download
router.get('/:release_id/:study_id?', (req, res) => {
  const { release_id, study_id } = req.params;
  // file_format is set as given if specified else 'gz'
  const file_format = req.query.file_format || 'gz';

  let Prefix;
  if (!study_id) Prefix = `${release_id}`;
  else Prefix = `${release_id}/${study_id}`;

  const params = { Bucket: SNAPSHOT_BUCKET, Prefix };

  listObjectsAsync(params)
    .then((body) => {
      // handles if a release/study does not exist
      if (body.Contents.length === 0) {
        res.status(404).json({
          message: `${study_id || release_id} not found`,
        });
      }

      return getObjectsAsync(params, body.Contents);
    })
    .then((obj) => {
      // set response headers
      res.attachment(
        `${study_id || release_id}.json.${file_format}`,
      );

      // create a readable object stream
      const readStream = new Readable();
      readStream.push(JSON.stringify(obj));
      readStream.push(null);

      // pipe readStream into gzip
      const gzip = zlib.createGzip();
      readStream.pipe(gzip).pipe(res);
    })
    .catch((err) => {
      return res.status(err.statusCode).json(err);
    });
});

// import environment variables
const { SNAPSHOT_BUCKET } = process.env;

/**
 * @access private
 * listObjectsAsync() lists objects in S3
 * @param {Object} params
 * @returns {Object}
 */
const listObjectsAsync = (params) => {
  return new Promise((resolve, reject) => {
    const { Bucket, Prefix } = params;
    console.log(`LISTing ${Prefix} in ${Bucket}`);
    s3.listObjects(params, (err, body) => {
      err ? reject(err) : resolve(body);
    });
  });
};

/**
 * @access private
 * getObjectsAsync() retrieves objects in S3
 * @param {Object} params
 * @param {Object} contents
 * @returns {Object}
 */
const getObjectsAsync = (params, contents) => {
  return new Promise((resolve, reject) => {
    const obj = {};
    delete params.Prefix;
    let count = contents.length;
    contents.forEach((content) => {
      const { Key } = content;
      params.Key = Key;

      getObjectAsync(params)
        .then((body) => {
          nest(obj, Key.split('/'), JSON.parse(body.Body));
          count -= 1;
          if (count <= 0) resolve(obj);
        })
        .catch((err) => { reject(err); });
    });
  });
};

/**
 * @access private
 * getObjectAsync() retrieves an object in S3
 * @param {Object} params
 * @returns {Object}
 */
const getObjectAsync = (params) => {
  return new Promise((resolve, reject) => {
    const { Bucket, Key } = params;
    console.log(`GETting ${Key} in ${Bucket}`);
    s3.getObject(params, (err, body) => {
      err ? reject(err) : resolve(body);
    });
  });
};

/**
 * @access private
 * nest() creates a nested object
 * @param {Object} obj
 * @param {Object[]} keys
 * @param {Object} value
 * @returns {Object}
 */
const nest = (obj, keys, value) => {
  const key = keys.shift().split('.').shift();
  if (keys.length === 0) obj[key] = value;
  else {
    obj[key] = nest(
      obj[key] === undefined ? {} : obj[key], keys, value,
    );
  }

  return obj;
};

module.exports = router;
