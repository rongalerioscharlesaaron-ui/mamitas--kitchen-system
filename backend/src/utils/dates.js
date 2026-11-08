const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Today's date in Singapore as YYYY-MM-DD (the same day the database calls CURRENT_DATE)
export const todaySG = () => formatter.format(new Date());