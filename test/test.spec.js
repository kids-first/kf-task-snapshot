const request = require('request');
const { expect } = require('chai');

const app = require('../app');


const host = process.env.HOST || 'localhost';
const port = process.env.PORT || 3030;
let server;

before((done) => {
  server = app.listen(port, done);
});

const options = {
  baseUrl: `http://${host}:${port}`,
  headers: {
    'Content-Type': 'application/json',
  },
};

describe('Sending a request', () => {
  describe('GET /status', () => {
    options.uri = '/status';
    options.method = 'GET';

    it('should return statusCode equal to 200', () => {
      request(options, (err, res) => {
        expect(res.statusCode).to.equal(200);
      });
    });

    const data = JSON.stringify({
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
});

after((done) => {
  server.close(done);
});
