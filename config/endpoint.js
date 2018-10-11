const request = require('request');
const pluralize = require('pluralize');


require('dotenv').config();

const ENDPOINTS = {};
const options = {
  uri: '/swagger',
  baseUrl: process.env.DATASERVICE_API,
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
};

request.get(options, (err, res, body) => {
  if (err) console.log(err.message);
  else {
    const data = JSON.parse(body);
    const paths = Object.keys(data.paths);
    paths.forEach((path) => {
      const endpoint = path.split('/')[1];
      if (endpoint !== 'status') {
        const entity = endpoint.split('-')
          .map(pluralize.singular).join('_');
        ENDPOINTS[entity] = `/${endpoint}`;
      }
    });
  }
});

module.exports = ENDPOINTS;
