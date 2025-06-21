// src/models/Visit.js
const mongoose = require('mongoose');

const VisitSchema = new mongoose.Schema({
  location:    { type: String, required: true },
  date:        { type: String, required: true },
  status:      { type: String, default: null },  // e.g. "MD Exit", "OD/Post-Op Exit", "No-Show/Resched"
  time:        { type: String, required: true }, // e.g. "9:05a"
  patient:     { type: String, required: true }, // e.g. "Chavez, Fidel"

  // newly scraped fields:
  doctor:      { type: String, default: null },  // e.g. "MA"
  type:        { type: String, default: null },  // e.g. "NEW PATIENT" or "FOLLOW UP"
}, {
  timestamps: true
});

module.exports = mongoose.model('Visit', VisitSchema);
