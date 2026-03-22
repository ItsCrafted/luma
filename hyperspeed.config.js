self.__hyperspeed$config = {
  prefix: '/proxy/',
  encodeUrl: (url) => btoa(url),
  decodeUrl: (str) => atob(str),
  handler: '/hyperspeed.handler.js',
  client: '/hyperspeed.client.js',
  bundle: '/hyperspeed.bundle.js',
  config: '/hyperspeed.config.js',
  sw: '/sw.js',
};