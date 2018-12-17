const request = require('request');
const { expect } = require('chai');

const app = require('../app');


const host = process.env.HOST || 'localhost';
const port = process.env.PORT || 3030;
let server;

before(() => { server = app.listen(port); });

const options = {
  baseUrl: `http://${host}:${port}`,
  headers: {
    'Content-Type': 'application/json',
  },
};

describe('Sending a request', () => {
  let data;

  describe('GET /status', () => {
    options.uri = '/status';
    options.method = 'GET';

    it('should return statusCode equal to 200', () => {
      request(options, (err, res) => {
        expect(res.statusCode).to.equal(200);
      });
    });

    data = JSON.stringify({
      message: {
        name: 'snapshot task',
        version: '1.0.0',
      },
    });
    it(`should return body equal to ${data}`, () => {
      request(options, (err, res, body) => {
        expect(body).to.equal(data);
      });
    });
  });

  describe('GET /download', () => {
    options.uri = '/download';

    it('should return statusCode equal to 400', () => {
      request(options, (err, res) => {
        expect(res.statusCode).to.equal(400);
      });
    });

    data = JSON.stringify({
      message: 'missing a required field',
    });
    it(`should return body equal to ${data}`, () => {
      request(options, (err, res, body) => {
        expect(body).to.equal(data);
      });
    });

    options.qs = { file_format: 'gz' };
    options.uri += '/RE_00000001';

    it('should return statusCode equal to 404', () => {
      request(options, (err, res) => {
        expect(res.statusCode).to.equal(404);
      });
    });

    data = JSON.stringify({
      message: 'release not found',
    });
    it(`should return body equal to ${data}`, () => {
      request(options, (err, res, body) => {
        expect(body).to.equal(data);
      });
    });

    options.uri = '/download/RE_5N9ZMDSM/SD_00000001';

    it('should return statusCode equal to 404', () => {
      request(options, (err, res) => {
        expect(res.statusCode).to.equal(404);
      });
    });

    data = JSON.stringify({
      message: 'study not found',
    });
    it(`should return body equal to ${data}`, () => {
      request(options, (err, res, body) => {
        expect(body).to.equal(data);
      });
    });
  });
});

after(() => { server.close(); });
