import test from 'node:test';
import assert from 'node:assert/strict';
import {getGroupDropDirection} from '../src/group-view.mjs';

const rect={left:100,top:80,width:400,height:600};

test('content edges select the appropriate split and the middle stays in the group',()=>{
  assert.equal(getGroupDropDirection(rect,120,380),'left');
  assert.equal(getGroupDropDirection(rect,480,380),'right');
  assert.equal(getGroupDropDirection(rect,300,100),'up');
  assert.equal(getGroupDropDirection(rect,300,660),'down');
  assert.equal(getGroupDropDirection(rect,300,380),null);
  assert.equal(getGroupDropDirection(rect,200,230),null);
});

test('corners use the nearest normalized edge for wide or tall groups',()=>{
  assert.equal(getGroupDropDirection(rect,180,100),'up');
  assert.equal(getGroupDropDirection(rect,110,180),'left');
  assert.equal(getGroupDropDirection(rect,480,660),'down');
  assert.equal(getGroupDropDirection({left:0,top:0,width:1000,height:100},800,5),'up');
});

test('tab bars, outside points, and unavailable geometry do not create split directions',()=>{
  for(const point of [[99,380],[501,380],[300,79],[300,681]])assert.equal(getGroupDropDirection(rect,...point),null);
  assert.equal(getGroupDropDirection({...rect,width:0},120,100),null);
  assert.equal(getGroupDropDirection({...rect,height:NaN},120,100),null);
  assert.equal(getGroupDropDirection(rect,NaN,100),null);
  assert.equal(getGroupDropDirection(null,120,100),null);
});
