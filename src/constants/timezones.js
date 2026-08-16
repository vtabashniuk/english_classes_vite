export const TIMEZONES = [
  { value: "America/New_York", labelKey: "timezones.usCanadaEastern" },
  { value: "America/Chicago", labelKey: "timezones.usCanadaCentral" },
  { value: "America/Denver", labelKey: "timezones.usCanadaMountain" },
  { value: "America/Los_Angeles", labelKey: "timezones.usCanadaPacific" },
  { value: "Atlantic/Reykjavik", labelKey: "timezones.iceland" },
  { value: "Europe/Lisbon", labelKey: "timezones.portugal" },
  { value: "Europe/London", labelKey: "timezones.ukIreland" },
  { value: "Europe/Berlin", labelKey: "timezones.centralEurope" },
  { value: "Europe/Kyiv", labelKey: "timezones.easternEurope" },
  { value: "Europe/Moscow", labelKey: "timezones.moscow" },
  { value: "Europe/Istanbul", labelKey: "timezones.turkey" },
  { value: "Asia/Jerusalem", labelKey: "timezones.israel" },
  { value: "Asia/Beirut", labelKey: "timezones.lebanon" },
  { value: "Asia/Riyadh", labelKey: "timezones.arabianPeninsula" },
  { value: "Asia/Dubai", labelKey: "timezones.uaeOman" },
  { value: "Asia/Tbilisi", labelKey: "timezones.georgia" },
  { value: "Asia/Yerevan", labelKey: "timezones.armenia" },
  { value: "Asia/Baku", labelKey: "timezones.azerbaijan" },
  { value: "Asia/Aqtobe", labelKey: "timezones.westKazakhstan" },
  { value: "Asia/Almaty", labelKey: "timezones.kazakhstan" },
];

export const getTimezone = (value) =>
  TIMEZONES.find((timezone) => timezone.value === value);
