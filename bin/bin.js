#!/usr/bin/env node
'use strict';
const { upgrade } = require('../dist/index');
upgrade()
  .then(() => {})
  .catch(e => {
    console.error('Upgrade fail!', e.message);
  });
