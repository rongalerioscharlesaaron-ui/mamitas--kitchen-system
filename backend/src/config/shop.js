import './env.js'; // makes sure backend/.env is loaded first

const flag = (value, fallback) =>
  value === undefined ? fallback : String(value).toLowerCase() === 'true';

export const shop = {
  name: 'Mamitas’ Kitchen',
  location: 'Singapore',
  currency: 'SGD',
  gstRegistered: flag(process.env.GST_REGISTERED, false),
  gstRate: Number(process.env.GST_RATE) || 0.09,
  gstRegNo: process.env.GST_REG_NO || '',
};