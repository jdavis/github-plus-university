var express = require('express'),
    swig = require('swig'),
    crypto = require('crypto'),
    util = require('util'),
    request = require('request'),
    sqlite3 = require('sqlite3').verbose(),
    github = require('github'),
    csv = require('csv'),
    secret = require('./secret');

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

    // Main Team
    student_team: '634635',

    // Prefix for teams
    team_prefix: 'Students: ',

    // Prefix for student's repo
    repo_prefix: 'hw-answers-',
};

handler = {};

//
// Basic DB for storing access tokens
//

db = new sqlite3.Database('accessTokens.db');

//
// Express Setup/Config
//

app = express();

app.set('port', process.env.PORT || 4000);
app.set('host', process.env.IP || '0.0.0.0');

// Use Swig for templates
app.engine('html', swig.renderFile);
app.set('view engine', 'html');

app.set('views', __dirname + '/views');

// Setup sessions
app.use(express.cookieParser());
app.use(express.session({secret: secret.SESSION_SECRET}));

// Server up static
app.use(express.static(__dirname + '/public'))

// Setup POST handling
app.use(express.bodyParser());

//
// Routing
//

// Home:
// Shows the sign in & join button
app.get('/', function (req, res) {
    var context = {},
        state;

    crypto.randomBytes(48, function (ex, buf) {
        state = buf.toString('hex');

        // Provided by GitHub for API access
        context['client_id'] = secret.CLIENT_ID;
        context['state'] = encodeURIComponent(state);

        // Set in session for checking later
        req.session.state = state;

        res.render('home', context);
    })
});

// GitHub API callback as setup here:
//      https://github.com/organizations/ComS342-ISU/settings/applications
app.get('/auth', function (req, res) {
    var code = req.query.code;

    var state = req.query.state;
    var token = req.session.state;

    console.log('Given Query: ' + req.query.state);
    console.log('Given Code: ' + state);
    console.log('Token: ' + token);
    console.log('Session: ' + util.inspect(req.session));

    // Show error if invalid token
    if (token && token !== state) {
        return res.render('error', {
            error: 'invalid token'
        });
    }

    // Set GitHub temporary code for access after redirect
    req.session.tempCode = code;

    handler.requestAccessToken(req, res, code);
});

app.get('/add', function (req, res) {
    var context = {};

    if (req.session.status !== true) {
        return res.redirect('/');
    }

    context['name'] = req.session.name || req.session.username;

    res.render('add', context);
});

app.post('/add', function (req, res) {
    var netID = req.body.netID;

    if (req.session.status !== true) {
        return res.redirect('/');
    }

    handler.validateNetID(req, res, netID);
});

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

handler.requestAccessToken = function (req, res, code) {
    var options = {
        method: 'POST',
        qs: {
            client_id: secret.CLIENT_ID,
            client_secret: secret.CLIENT_SECRET,
            code: code,
        },
        headers: {
            'Accept': 'application/json'
        },
    };

    request(
        'https://github.com/login/oauth/access_token',
        options,
        handler.retrieveAccessToken.bind(handler, req, res)
    );
};

handler.retrieveAccessToken = function (req, res, err, response, body) {
    if (err || response.statusCode !== 200) {
        return res.render('error', {
            error: 'invalid token',
        });
    }

    var data = JSON.parse(body),
        token;

    token = data.access_token;

    console.log('Body: ' + body);
    console.log('Access Token: ' + token);

    if (!token) {
        return res.render('error', {
            error: 'invalid token',
        });
    }

    options = {
        qs: {
            access_token: token,
        },
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'ComS 342 Course Bot',
        },
    };

    request(
        'https://api.github.com/user',
        options,
        handler.setGitHubInfo.bind(handler, req, res, token)
    );
};

handler.setGitHubInfo = function (req, res, token, err, response, body) {
    // TODO: Check err

    var data = JSON.parse(body),
        found = false;

    console.log('Data: ' + util.inspect(data));

    req.session.status = true;
    req.session.name = data.name;
    req.session.username = data.login;
    req.session.token = token;

    // Add student info to the database
    db.serialize(function () {
        db.run('INSERT INTO tokens VALUES (?, ?)', data.login, token);
    });

    return res.redirect('/add');
};



handler.validateNetID = function (req, res, netID) {
    var student = {},
        found = false;

    if (!netID) {
        return res.render('add', {
            error: true,
            name: req.session.name || req.session.username,
        });
    }

    // Trim whitespace just in case
    netID = netID.trim();

    if (netID.indexOf('@iastate.edu') !== -1) {
        netID = netID.substring(0, netID.length - '@iastate.edu'.length);
    }

    student.username = req.session.username;
    student.name = req.session.name;
    student.token = req.session.token;
    student.netID = netID;

    csv().from.path('./students.csv', {
        columns: ['last_name', 'first_name', 'username']
    }).on('record', function (row, i) {
        if (netID === row.username) {
            found = true;
        }
    }).on('end', function () {
        if (found === false) {
            return res.render('error', {
                error: 'not on roster',
            });
        } else {
            handler.addStudent(req, res, student);
        }
    });
};

handler.addStudent = function (req, res, student) {
    var gh = {};

    gh.student = student;

    gh.api = handler.initGitHubAPI();

    gh.api.orgs.getMember({
        org: config.org,
        user: student.username,
    }, handler.checkMembership.bind(handler, req, res, gh));
}

handler.checkMembership = function (req, res, gh, err, ret) {
    console.log('Checked membership: ' + util.inspect(ret));
    console.log('Checked membership err: ' + util.inspect(err));

    if (ret && ret.meta && ret.meta.status === '204 No Content') {
        return res.render('error', {
            error: 'already member',
            repo: config.repo_prefix + gh.student.netID,
        });
    }

    // Getting an error means they aren't a member
    if (!err) {
        return res.render('error', {
            error: 'failed checking membership',
        });
    }

    gh.api.orgs.createTeam({
        org: config.org,
        name: config.team_prefix + gh.student.netID,
        permission: 'push',
    }, handler.addStudentToOwnTeam.bind(handler, req, res, gh));
};

handler.addStudentToOwnTeam = function (req, res, gh, err, ret) {
    if (err) {
        return res.render('error', {
            error: 'failed creating a team',
        });
    }

    console.log('Created team: ' + util.inspect(ret));

    gh.team = ret.id;

    gh.api.orgs.addTeamMember({
        id: gh.team,
        user: gh.student.username,
    }, handler.addUserToStudentsTeam.bind(handler, req, res, gh));
};

handler.addUserToStudentsTeam = function (req, res, gh, err, ret) {
    if (err) {
        return res.render('error', {
            error: 'failed adding to Students',
        });
    }

    console.log('Added student to own team: ' + util.inspect(ret));

    gh.api.orgs.addTeamMember({
        id: config.student_team,
        user: gh.student.username,
    }, handler.createSolutionsRepo.bind(handler, req, res, gh));
};

handler.createSolutionsRepo = function (req, res, gh, err, ret) {
    if (err) {
        return res.render('error', {
            error: 'failed adding to team',
        });
    }

    console.log('Added student to Students: ' + util.inspect(ret));

    var name = gh.student.name || gh.student.username;

    gh.api.repos.createFromOrg({
        org: config.org,
        name: config.repo_prefix + gh.student.netID,
        description: 'Homework solutions for ' + name + ', NetID: ' + gh.student.netID,
        private: true,
        has_issues: true,
        team_id: gh.team,
    }, handler.apiFinishSetup.bind(handler, req, res, gh));
};

handler.apiFinishSetup = function (req, res, gh, err, ret) {
    var context;

    if (err) {
        return res.render('error', {
            error: 'failed creating new repo',
        });
    }

    console.log('Created new repo:' + util.inspect(ret));

    context = gh.student;
    context.repo = config.repo_prefix + gh.student.netID;

    return res.render('success', context);
};

//
// Launch app
//

app.listen(app.get('port'), app.get('host'), function () {
    console.log('CourseBot listening on ' + app.get('host') + ':' + app.get('port'));
});
