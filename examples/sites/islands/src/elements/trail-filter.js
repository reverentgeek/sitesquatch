// <trail-filter><ul><li data-level="easy">...</li></ul></trail-filter>: a
// box that filters the list inside it. The list is already in the page.
class TrailFilter extends HTMLElement {
	connectedCallback() {
		const items = [ ...this.querySelectorAll( "li" ) ];
		const label = document.createElement( "label" );
		label.textContent = "Filter trails ";
		const input = document.createElement( "input" );
		input.type = "search";
		input.addEventListener( "input", () => {
			const words = input.value.toLowerCase().split( /\s+/ ).filter( Boolean );
			for ( const item of items ) {
				const text = item.textContent.toLowerCase();
				item.hidden = !words.every( w => text.includes( w ) );
			}
		} );
		label.append( input );
		this.prepend( label );
	}
}

customElements.define( "trail-filter", TrailFilter );
