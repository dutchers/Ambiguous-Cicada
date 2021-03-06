// Basic Server Requirements
var config = require('./config.js');
var https = require('https');
var express = require('express');
var bodyParser = require('body-parser');
var logger = require('morgan');
var cors = require('cors');
var session = require('express-session');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io').listen(server);
server.listen(config.port, function () {
  console.log('Listening on: ', config.port);
});
var coord = require('./match/coordMatcher.js');
var coordMatcher = new coord();

// Internal Dependencies
var auth = require('./auth/auth');
var matchCtrl = require('./match/matchController');
var chatCtrl = require('./chat/chatController');
var utils = require('./lib/utils');

if ((process.env.NODE_ENV === 'development') || !(process.env.NODE_ENV)) {
  app.use(logger('dev'));
}
// assigning the call to the yelp api to variable yelp and invoking method
// of yelp api and passing it the required authentication
var yelp = require('yelp').createClient(config.yelp);

app.use(cors());
app.use(bodyParser.json());
app.use(session({
  secret: 'vsafklj4kl2j34kl2',
  resave: true,
  saveUninitialized: true
}));
app.use("/", express.static(__dirname + '/../client-web'));

// Sockets Connection
io.sockets.on('connection', function (socket) {
  console.log('Socket ' + socket.id + ' connected.');
  socket.on('disconnect', function () {
    console.log('Socket ' + socket.id + ' disconnected.');
    socket.disconnect();
  });
});

// Sockets Matching Namespace
// setting up sockets for different namespaces
io.of('/match').on('connection', function (socket) {
  console.log(socket.id + "connected to /match");

  var userPool = {};

  socket.on('restaurantSearch', function (user) {
    //make api call to yelp
    //build some object of restaurants with name rating distance review count and image, iterating through the results from the api. for each result, call
    //match.coordMatcher._getDistance using the coords on user obj and coords on restaurant obj
    //send back array of restaurants back to the client
    var url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + user.location[0] + '&key=' + config.api_keys.geocoding;

    var searchObj = {
      term: "food",
      limit: 3,
      location: '', //TODO: DON'T HARD CODE LOCATION. MAKE CALL TO GEOCODE AND CONVERT LAT/LNG TO CITY, STATE
      cll: user.location[0],
      sort: '0',
      categoryfilter: 'Restaurants',
      radius_filter: '3218'
    };
    //Convert coords into an address
    https.get(url, function (res) {
      var address = '';
      res.on('data', function (data) {
        address += data;
      });
      res.on('end', function () {
        var result = JSON.parse(address);
        //the google gives you several variations on the address, here we're taking the most specific.

        searchObj.location = result.results[0].formatted_address;

        var restToClient = [];

        yelp.search(searchObj, function (error, data) {
          var restaurants = data.businesses;
          for (var i = 0; i < restaurants.length; i++) {
            var rest = {};
            rest.name = restaurants[i].name;
            rest.rating = restaurants[i].rating;
            rest.review_count = restaurants[i].review_count;
            rest.image_url = restaurants[i].image_url;
            rest.distance = coordMatcher._getDistance(user.location[1], restaurants[i].location.coordinate);

            restToClient.push(rest);
          }
          socket.emit('restaurants', restToClient);
        });
      });
    });
    socket.on('matching', function (user) {
        matchCtrl.add(user, function (chatRoomId) {
          socket.emit('matched', chatRoomId);
        });

    });


  });
});

// Sockets Chatting Namespace
io.of('/chat').on('connection', function (socket) {
  console.log(socket.id + "connected to /chat");
  socket.on('loadChat', function (chatRoomId) {

    socket.join(chatRoomId);
    socket.on('message', function (message) {
      console.log('Emitted from client to server');
      socket.to(chatRoomId).broadcast.emit('message', message);
      chatCtrl.addMessage(chatRoomId, message);
    });
  });
  socket.on('leaveChat', function (chatRoomId) {
    socket.to(chatRoomId).broadcast.emit('leaveChat');
    var room = io.nsps['/chat'].adapter.rooms[chatRoomId];
    for (var sock in room) {
      io.sockets.connected[sock].leave(chatRoomId);
    }
  });
});

// Authentication Routes
app.post('/signup', function (req, res) {
  auth.signup(req.body.username, req.body.password)
    .then(function (result) {
      res.status(201)
        .send(result);
    })
    .catch(function (err) {
      res.status(300)
        .send(err);
    });
});

app.post('/login', function (req, res) {
  auth.login(req.body.username, req.body.password)
    .then(function (user) {
      utils.createSession(req, res, user, function () {
        res.status(200).send(user);
      });
    })
    .catch(function (err) {
      res.status(300)
        .send(err);
    });
});

app.post('/logout', utils.destroySession, function (req, res) {
  res.status(200).end();
});
