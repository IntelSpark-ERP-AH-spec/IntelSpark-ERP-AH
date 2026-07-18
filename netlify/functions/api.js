const serverless = require('serverless-http');
const { prepareApp } = require('../../server');

let handlerPromise;

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = prepareApp().then((app) => serverless(app));
  }
  return handlerPromise;
}

exports.handler = async (event, context) => {
  const handler = await getHandler();
  return handler(event, context);
};
