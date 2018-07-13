'use strict';

const expect = require('chai').expect;
const request = require('request');


const host = process.env.HOST || 'localhost';
const port = process.env.PORT || 3030;
const options = { 
    baseUrl: `http://${host}:${port}`,
    headers: {
        'content-type': 'application/json'
    }
};       

describe('Sending a request', () => {
    describe('GET /status', () => {
        options.url = '/status'
        options.method = 'GET';
        
        it('should return statusCode equal to 200', () => {
            request(options, (err, res, data) => {
                expect(res.statusCode).to.equal(200);
            })
        });
    });
});