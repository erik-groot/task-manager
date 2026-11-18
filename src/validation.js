import { SECTIONS, PRIORITIES } from '../public/planning.js';

export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function validateFields(body, partial = false) {
  const fields = {};
  if (!partial || 'title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
      throw new RequestError(400, 'Title must contain between 1 and 200 characters.');
    }
    fields.title = body.title.trim();
  }
  for (const [key, limit] of [['notes', 4000], ['dueDate', 10]]) {
    if (!partial || key in body) {
      const value = body[key] ?? '';
      if (typeof value !== 'string' || value.length > limit) throw new RequestError(400, `Invalid ${key}.`);
      fields[key] = value;
    }
  }
  if (fields.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate) ||
      !Number.isFinite(Date.parse(fields.dueDate)) ||
      new Date(fields.dueDate).toISOString().slice(0, 10) !== fields.dueDate)) {
    throw new RequestError(400, 'Choose a valid due date.');
  }
  if (!partial || 'priority' in body) {
    fields.priority = body.priority === 'normal' ? 'medium' : body.priority ?? 'medium';
    if (!PRIORITIES.includes(fields.priority)) throw new RequestError(400, 'Invalid priority.');
  }
  if (!partial || 'section' in body) {
    fields.section = body.section ?? 'backlog';
    if (!SECTIONS.includes(fields.section)) throw new RequestError(400, 'Invalid section.');
  }
  if ('section' in body && ['later', 'backlog'].includes(fields.section)) {
    if (fields.dueDate) throw new RequestError(400, 'Later and Backlog do not have a date.');
    fields.dueDate = '';
  }
  if ('section' in body && !['later', 'backlog'].includes(fields.section) && !fields.dueDate) {
    throw new RequestError(400, 'A scheduled section needs a due date.');
  }
  if (!partial || 'customer' in body) {
    if (body.customer !== undefined && (typeof body.customer !== 'string' || body.customer.length > 100)) {
      throw new RequestError(400, 'Customer must be at most 100 characters.');
    }
    fields.customer = (body.customer ?? '').trim();
  }
  if (!partial || 'type' in body) {
    fields.type = body.type ?? 'task';
    if (!['task', 'waiting'].includes(fields.type)) throw new RequestError(400, 'Invalid type.');
  }
  if ('completed' in body) {
    if (typeof body.completed !== 'boolean') throw new RequestError(400, 'Invalid completion status.');
    fields.completed = body.completed;
  }
  return fields;
}
