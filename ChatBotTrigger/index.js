var request = require('superagent');

module.exports = function (context, req) {
  var body_type = req.body.type;
  if (body_type == 'url_verification') {
    var body_challenge = req.body.challenge;
    context.res = {
      body: body_challenge,
    };
  } else if (body_type == 'event_callback') {
    // あとで実装
  } else {
    context.res = {
      status: 400,
      body: 'Bad Request. Please check your request parameters.',
    };
  }
  context.done();
};
