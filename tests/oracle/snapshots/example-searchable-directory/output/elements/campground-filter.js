// <campground-filter>: the region and amenity filters for the list inside it. The form is in
// the page, hidden, so its words are the template's; this shows it and makes it work. Each
// item says what it is in data-region and data-amenities. The choice goes in the address
// (?region=Lakeshore&has=water), so a filtered list can be linked, and a campground's page
// links its region that way.
class CampgroundFilter extends HTMLElement {
	connectedCallback() {
		const form = this.querySelector( "form" );
		const status = this.querySelector( "[role=status]" );
		const items = [ ...this.querySelectorAll( "li[data-region]" ) ];

		// Start from the address.
		const params = new URLSearchParams( location.search );
		form.elements.region.value = params.get( "region" ) ?? "";
		for ( const box of form.querySelectorAll( "[name=has]" ) ) box.checked = params.getAll( "has" ).includes( box.value );

		const update = () => {
			const data = new FormData( form );
			const region = data.get( "region" );
			const has = data.getAll( "has" );
			let shown = 0;
			for ( const item of items ) {
				const amenities = item.dataset.amenities.split( " " );
				item.hidden = ( region && item.dataset.region !== region ) || !has.every( ( key ) => amenities.includes( key ) );
				if ( !item.hidden ) shown++;
			}
			status.textContent = shown === items.length ? `All ${items.length} campgrounds` : shown === 0 ? "No campground has all of that. Try fewer filters." : `${shown} of ${items.length} campgrounds`;
			const query = new URLSearchParams();
			if ( region ) query.set( "region", region );
			for ( const key of has ) query.append( "has", key );
			history.replaceState( null, "", query.size ? `?${query}` : location.pathname );
		};

		form.addEventListener( "change", update );
		form.addEventListener( "submit", ( event ) => event.preventDefault() );
		form.hidden = false;
		update();
	}
}

customElements.define( "campground-filter", CampgroundFilter );
