'use strict';

const expect = require('chai').expect;
const request = require('request-promise');


const host = process.env.HOST || 'localhost';
const port = process.env.PORT || 3000;
const options = { resolveWithFullResponse: true }; 

describe('Sending a request', () => {
    describe('GET /status', () => {
        options.method = 'GET';
        options.uri = `http://${host}:${port}/status`
        
        it('should return statusCode equal to 200', () => {
            request(options)
                .then((res) => {
                    expect(res.statusCode).to.equal(200);
                });
        });
    });
});