// The home page's questions and answers as structured data, from src/_data/faqs.json, so a search
// engine can show them under the result.
export default {
	computed: {
		jsonld: data => [
			{
				"@context": "https://schema.org",
				"@type": "FAQPage",
				mainEntity: data.faqs.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }))
			}
		]
	}
};
