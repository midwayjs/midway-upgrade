#!/usr/bin/env node
'use strict';
const { upgrade } = require('../dist/index');
upgrade().then(res => {}).catch(e => {
  console.error('Upgrade fail!', e.message);
});