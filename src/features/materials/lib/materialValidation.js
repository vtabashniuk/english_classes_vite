// Commas/semicolons/newlines preserve multiword tags ("Past Simple").
// If no explicit delimiter is used, single-word tags may be separated by spaces.
// Quoting also allows a multiword tag in space-separated input: "Past Simple" A2.
export const parseMaterialTags = (value = "") => {
  const source = String(value).trim();
  const parts = /[,;\n]/.test(source)
    ? source.split(/[,;\n]+/)
    : source.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  const seen = new Set();
  return parts.map((tag) => tag.trim().replace(/^['"]|['"]$/g, "").replace(/^#/, "").trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

// Kept for compatibility with existing utilities that still accept newline URL lists.
export const parseResourceUrls = (value = "") =>
  String(value).split(/\n+/).map((url) => url.trim()).filter(Boolean);

export const validateMaterial = ({ title, description, resources }) => {
  if (!title?.trim() || !description?.trim() || !resources?.length) {
    return "materialsFeature.validation";
  }
  if (resources.some(({ title: name }) => !name?.trim() || name.trim().length > 200)) {
    return "materialsFeature.resourceNameRequired";
  }
  if (resources.some(({ url }) => {
    try {
      const parsed = new URL(url.trim());
      return !["http:", "https:"].includes(parsed.protocol) || url.trim().length > 2000;
    } catch { return true; }
  })) return "materialsFeature.invalidUrl";
  return null;
};

export const getMaterialResourceLabel = (resource, index, t) => {
  const name = resource?.title?.trim();
  // Old URLs may still carry generated placeholders from the original migration.
  if (name && !/^Resource\s+\d+$/i.test(name)) return name;
  let source = t("materialsFeature.externalSource");
  try {
    const hostname = new URL(resource?.external_url).hostname.toLowerCase();
    if (hostname.includes("youtube.com") || hostname === "youtu.be") source = "YouTube";
    else if (hostname.includes("onedrive") || hostname.includes("1drv.ms") || hostname.includes("sharepoint")) source = "OneDrive";
    else source = hostname.replace(/^www\./, "");
  } catch { /* Legacy URL without a usable hostname. */ }
  return `${source} · ${t("materialsFeature.resourceNumber", { number: index + 1 })}`;
};
