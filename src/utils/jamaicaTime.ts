const JAMAICA_UTC_OFFSET_HOURS = 5;

export const getJamaicaDateInputValue = (value: Date = new Date()) => {
  const shifted = new Date(value.getTime() - JAMAICA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};