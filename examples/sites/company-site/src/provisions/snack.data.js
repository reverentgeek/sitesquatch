// Each snack page's title, description, link-preview card and Product structured data, from its
// snack. Structured data wants whole addresses, under the site's base when it has one
// (withBase); imageUrl() is the address of the picture's published copy.
import { readData, withBase } from "ssqch";
import { imageUrl } from "ssqch/image";

const site = readData("src/_data/site.json");
const whole = (path) => new URL(withBase(path), site.url).href;

export default {
	computed: {
		title: data => data.snack.name,
		description: data => `${ data.snack.tagline} ${ data.snack.description}`,
		ogImage: data => data.snack.image,
		ogImageAlt: data => data.snack.imageAlt,
		jsonld: async data => {
			const { snack } = data;
			return [
				{
					"@context": "https://schema.org",
					"@type": "Product",
					name: snack.name,
					description: snack.description,
					sku: snack.slug,
					url: whole(`/provisions/${snack.slug}/`),
					image: snack.image ? whole((await imageUrl(snack.image, { width: 800 })).url) : undefined,
					brand: { "@type": "Brand", name: site.title },
					offers: { "@type": "Offer", price: String(snack.price), priceCurrency: "USD", availability: "https://schema.org/InStock" }
				}
			];
		}
	}
};
