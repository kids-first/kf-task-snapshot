'use strict';

const chai = require('chai');
const http = require('http');


const expect = chai.expect;
const options = {
    host: process.env.HOST || 'localhost',
    port: process.env.PORT || 3000
};

describe('Sending a request', () => {
    describe('GET /status', () => {
        options.method = 'GET';
        options.path = '/status';
        
        it('should return statusCode equal to 200', () => {
            http.request(options, (res) => {
                expect(res.statusCode).to.equal(200);
            });
        });
    });
});