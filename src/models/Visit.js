// src/models/Visit.js
// (no changes needed until we build out retrieval / leaderboard logic)
const mongoose = require('mongoose');

const VisitSchema = new mongoose.Schema({
  location: { type: String, required: true },
  date:     { type: String, required: true },
  status:   { type: String, default: null },
  time:     { type: String, required: true },
  patient:  { type: String, required: true },
  doctor:   { type: String, default: null },
  type:     { type: String, default: null },
  reason:   { type: String, default: null },
}, {
  timestamps: true
});

module.exports = mongoose.model('Visit', VisitSchema);
