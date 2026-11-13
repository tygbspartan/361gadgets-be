/*
 * Nepal address rules for checkout and saved addresses. The storefront form
 * (361-fe src/constants/checkout.ts) uses the same lists and formats; change
 * both together.
 */

export const NEPAL_PROVINCES = [
  "Koshi Province",
  "Madhesh Province",
  "Bagmati Province",
  "Gandaki Province",
  "Lumbini Province",
  "Karnali Province",
  "Sudurpashchim Province",
] as const;

// All 77 districts. The checkout "City / District" field must be one of these.
export const NEPAL_DISTRICTS = [
  "Achham", "Arghakhanchi", "Baglung", "Baitadi", "Bajhang", "Bajura",
  "Banke", "Bara", "Bardiya", "Bhaktapur", "Bhojpur", "Chitwan", "Dadeldhura",
  "Dailekh", "Dang", "Darchula", "Dhading", "Dhankuta", "Dhanusha", "Dolakha",
  "Dolpa", "Doti", "Gorkha", "Gulmi", "Humla", "Ilam", "Jajarkot", "Jhapa",
  "Jumla", "Kailali", "Kalikot", "Kanchanpur", "Kapilvastu", "Kaski",
  "Kathmandu", "Kavrepalanchok", "Khotang", "Lalitpur", "Lamjung",
  "Mahottari", "Makwanpur", "Manang", "Morang", "Mugu", "Mustang", "Myagdi",
  "Nawalparasi", "Nawalpur", "Nuwakot", "Okhaldhunga", "Palpa", "Panchthar",
  "Parbat", "Parsa", "Pyuthan", "Ramechhap", "Rasuwa", "Rautahat", "Rolpa",
  "Rukum East", "Rukum West", "Rupandehi", "Salyan", "Sankhuwasabha",
  "Saptari", "Sarlahi", "Sindhuli", "Sindhupalchok", "Siraha", "Solukhumbu",
  "Sunsari", "Surkhet", "Syangja", "Tanahu", "Taplejung", "Terhathum",
  "Udayapur",
] as const;

// Districts that get the inside-valley shipping rate.
export const VALLEY_DISTRICTS: readonly string[] = ["Kathmandu", "Lalitpur", "Bhaktapur"];

export const isInsideValley = (district: string): boolean =>
  VALLEY_DISTRICTS.includes(district);

// Find the list entry matching `value` regardless of case/spacing, so
// "kathmandu " is stored as "Kathmandu". Undefined if there is no match.
export const matchListEntry = <T extends string>(
  list: readonly T[],
  value: string,
): T | undefined => {
  const wanted = value.trim().replace(/\s+/g, " ").toLowerCase();
  return list.find((entry) => entry.toLowerCase() === wanted);
};

/*
 * Nepali mobile numbers: 10 digits starting with 97 or 98 (NTC, Ncell, ...).
 * Spaces, dashes and a +977 / 977 country prefix are accepted and stripped,
 * so "+977 976-8988420" is stored as "9768988420".
 */
export const normalizeNepalPhone = (value: string): string =>
  value.replace(/[\s\-()]/g, "").replace(/^\+?977/, "");

export const NEPAL_MOBILE_REGEX = /^9[78]\d{8}$/;

// Nepal postal codes are 5 digits (e.g. 44600 for Kathmandu).
export const NEPAL_POSTAL_REGEX = /^\d{5}$/;
