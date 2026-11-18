import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueFor, sectionFor, completionReview } from '../public/planning.js';

const at = date => new Date(`${date}T12:00:00`);

test('weekly assignments always use Friday in a Monday–Sunday calendar week', () => {
  for (const date of ['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-21', '2026-11-22']) {
    assert.equal(dueFor('this-week', at(date)), '2026-11-20', date);
    assert.equal(dueFor('next-week', at(date)), '2026-11-27', date);
  }
  assert.equal(dueFor('this-week', at('2026-12-31')), '2027-01-01');
  assert.equal(dueFor('next-week', at('2026-12-31')), '2027-01-08');
});

test('calendar dates survive month/year/leap and daylight-saving transitions', () => {
  for (const [date, expected] of [['2026-12-31', '2027-01-01'], ['2028-02-28', '2028-02-29'], ['2026-03-28', '2026-03-29'], ['2026-10-24', '2026-10-25']]) {
    assert.equal(dueFor('today', at(date)), date);
    assert.equal(dueFor('tomorrow', at(date)), expected);
  }
  assert.equal(dueFor('later'), '');
  assert.equal(dueFor('backlog'), '');
});

test('explicit weekly intent is preserved when Friday is also today or tomorrow', () => {
  const task = { section: 'this-week', dueDate: '2026-11-20' };
  assert.equal(sectionFor(task, at('2026-11-19')), 'this-week');
  assert.equal(sectionFor(task, at('2026-11-20')), 'this-week');
  assert.equal(sectionFor(task, at('2026-11-21')), 'today');
  assert.equal(sectionFor({ section: 'tomorrow', dueDate: '2026-11-20' }, at('2026-11-19')), 'tomorrow');
  assert.equal(sectionFor({ section: 'tomorrow', dueDate: '2026-11-20' }, at('2026-11-20')), 'today');
  assert.equal(sectionFor({ section: 'next-week', dueDate: '2026-11-27' }, at('2026-11-23')), 'this-week');
});

test('review selects only incomplete tasks without dates, oldest first, from both Later and Backlog', () => {
  const tasks = [
    { id: 'later', section: 'later', dueDate: '', completed: false, createdAt: '2026-11-02' },
    { id: 'done', section: 'backlog', dueDate: '', completed: true, createdAt: '2026-10-01' },
    { id: 'backlog', section: 'backlog', dueDate: '', completed: false, createdAt: '2026-11-01' },
    { id: 'dated', section: 'today', dueDate: '2026-11-18', completed: false, createdAt: '2026-10-02' },
  ];
  assert.deepEqual(completionReview(tasks).map(task => task.id), ['backlog', 'later']);
  assert.equal(sectionFor(tasks[0]), 'later');
  assert.equal(sectionFor(tasks[2]), 'backlog');
});
