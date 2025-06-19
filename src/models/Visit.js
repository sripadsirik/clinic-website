// src/models/Visit.js
const mongoose = require('mongoose');

const VisitSchema = new mongoose.Schema({
  location: { type: String, required: true },
  date:     { type: String, required: true },   // e.g. '2025-06-18'
  time:     { type: String, required: true },   // e.g. '9:10a'
  patient:  { type: String, required: true },
  status:   { type: String, required: true },   // e.g. 'GrayOut', 'MD Exit', etc.
  checkIn:  { type: String, default: null },    // timestamp string from the title attribute
  portal:   { type: String, default: null },    // portal status string
}, {
  timestamps: true
});

module.exports = mongoose.model('Visit', VisitSchema);
