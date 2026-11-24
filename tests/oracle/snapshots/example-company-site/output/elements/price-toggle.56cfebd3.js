// <price-toggle>: a switch between the monthly and the yearly prices, on the pricing page.
// Without JavaScript the element is never defined, so both prices show, as written: "$12 a month,
// or $120 a year". With it, the switch goes on top and one set of prices shows at a time.
class PriceToggle extends HTMLElement {
	connectedCallback() {
		if (this.querySelector("[data-toggle]")) return;
		const fieldset = document.createElement("fieldset");
		fieldset.dataset.toggle = "";
		// The words come from the page (data-label, data-monthly, data-yearly), so the script has none of its own.
		const label = { monthly: this.dataset.monthly ?? "Monthly", yearly: this.dataset.yearly ?? "Yearly" };
		fieldset.innerHTML = `<legend class="visually-hidden">${this.dataset.label ?? "Billing period"}</legend>${["monthly", "yearly"].map(period => `<label><input type="radio" name="period" value="${period}"${period === "monthly" ? " checked" : ""}> ${label[period]}</label>`).join("")}`;
		this.prepend(fieldset);
		fieldset.addEventListener("change", e => this.show(e.target.value));
		this.show("monthly");
	}

	show(period) {
		this.dataset.period = period;
	}
}

customElements.define("price-toggle", PriceToggle);
