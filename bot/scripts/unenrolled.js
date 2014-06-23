var express = require('express'),
    swig = require('swig'),
    crypto = require('crypto'),
    util = require('util'),
    request = require('request'),
    sqlite3 = require('sqlite3').verbose(),
    github = require('github'),
    csv = require('csv'),
    nodemailer = require('nodemailer'),
    secret = require('../secret');

var app,
    db,
    config,
    handler;


//
// Basic Bot Config
//

config = {
    // Course Org
    org: 'ComS342-ISU',

    // Prefix for student's repo
    repo_prefix: 'hw-answers-',

    // ISU Email
    email: '@iastate.edu',
};

handler = {};

//
// Helper Functions that call GitHub's API
//

handler.initGitHubAPI = function () {
    var gh;

    gh = new github({
        version: '3.0.0',
    });

    gh.authenticate({
        type: 'oauth',
        token: secret.TOKEN
    });

    return gh;
};

handler.checkMembership = function (err, ret) {
    var gh = {
            api: handler.initGitHubAPI(),
            page: 1,
        },
        per_page = 100,
        registered = [],
        retrieveRepository = function (errr, ret) {
            var prevLen = registered.length;

            for (var prop in ret) {
                if (prop === 'meta') continue;

                var name = ret[prop].name;

                if (name.indexOf(config.repo_prefix) !== 0) continue;

                // Trim off config.repo_prefix, add it to students registered
                registered.push(name.substring(config.repo_prefix.length, name.length));
            }

            if (prevLen + 100 === registered.length) {
                page += 1;
                getNextPage(page);
            } else {
                return handler.checkStudentList(registered);
            }
        },
        getNextPage = function (page) {
            gh.api.repos.getFromOrg({
                org: config.org,
                type: 'member',
                per_page: 100,
                page: page,
            }, retrieveRepository);
        };


    getNextPage(1);
}

handler.checkStudentList = function (students) {
    var unregistered = [],
        unused = [],
        total = 0,
        repoCount = 0;

    unused = [].concat(students);
    repoCount = students.length;

    csv().from.path('./students.csv', {
        columns: ['last_name', 'first_name', 'username']
    }).on('record', function (row, i) {
        var id = row.username;

        total += 1;

        if (students.indexOf(id) === -1) {
            unregistered.push(id);
        }

        var x = unused.indexOf(id);

        if (x !== -1) {
            unused.splice(x, 1);
        }
    }).on('end', function () {
        console.log('Students Total: ' + total);
        console.log('Students Not on GitHub (' + unregistered.length + '):')
        console.log(unregistered.join('\n'));

        console.log('\nEmails:\n' + unregistered.join(config.email + ', ') + config.email);

        console.log('');
        console.log('Repositories Total: ' + repoCount);
        console.log('Unused Repos: (' + unused.length + '):')
        console.log(unused.join('\n'));
    });
}

//
// Start script
//

handler.checkMembership();
