// Dates are rendered with toLocaleDateString, so pin the time zone to keep results machine-independent
module.exports = () => {
  process.env.TZ = 'UTC'
}
