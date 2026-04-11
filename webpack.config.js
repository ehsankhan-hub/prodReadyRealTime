const path = require('path');

module.exports = {
  resolve: {
    alias: {
      '@int/geotoolkit': path.resolve(__dirname, './libs/int-geotoolkit-5.0.58.tgz'),
      '@int/geotoolkit3d': path.resolve(__dirname, './libs/int-geotoolkit3d-5.0.58.tgz'),
      '@int/impl': path.resolve(__dirname, './libs/int-impl-5.0.58.tgz')
    }
  }
};
