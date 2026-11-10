use sitesquatch_edge::{Engine, MemoryLoader, Value};

fn engine(partials: &[(&str, &str)]) -> Engine {
    let mut m = MemoryLoader::default();
    for (k, v) in partials {
        m.0.insert(k.to_string(), v.to_string());
    }
    let mut e = Engine::new(m);
    e.add_global("upper", Value::func(|a| Ok(Value::from(a[0].to_js_string().to_uppercase()))));
    e
}

fn data(json: &str) -> Value {
    Value::from(serde_json::from_str::<serde_json::Value>(json).unwrap())
}

fn render(src: &str, json: &str) -> String {
    engine(&[]).render_str("test", src, data(json)).unwrap()
}

#[test]
fn mustaches_escape_and_raw() {
    assert_eq!(render("{{ a }}|{{{ a }}}", r#"{"a":"<b>"}"#), "&lt;b&gt;|<b>");
    assert_eq!(render("{{ missing }}", "{}"), "");
    assert_eq!(render("{{-- gone --}}x", "{}"), "x");
    assert_eq!(render("@{{ raw }}", "{}"), "{{ raw }}");
}

#[test]
fn js_expressions() {
    let d = r#"{"site":{"url":"https://x.com"},"page":{"url":"/a/"},"n":2,"tags":["posts","js"],"s":"/img/a.png"}"#;
    assert_eq!(render("{{ site.url + page.url }}", d), "https://x.com/a/");
    assert_eq!(render("{{ n ? 'Page ' + (n + 1) : 'Home' }}", d), "Page 3");
    assert_eq!(render("{{ tags.includes('posts') && tags.length }}", d), "2");
    assert_eq!(render("{{ s.startsWith('http') ? s : site.url + s }}", d), "https://x.com/img/a.png");
    assert_eq!(render("{{ tags.slice().reverse().slice(0, 1) }}", d), "js");
    assert_eq!(render("{{ { tip: 'T', note: 'N' }[kind || 'note'] || 'X' }}", d), "N");
    assert_eq!(render("{{ tags.map(t => upper(t)).join(' ') }}", d), "POSTS JS");
    assert_eq!(render("{{ `${n * 1.5}rem` }}", d), "3rem");
    assert_eq!(render("{{ await upper('x') }}", d), "X");
    assert_eq!(render("{{ nope?.deep.chain }}", d), "");
    assert_eq!(render("{{{ JSON.stringify({ a: 1, b: [true] }) }}}", d), r#"{"a":1,"b":[true]}"#);
}

#[test]
fn conditionals_loops_and_whitespace() {
    let src = "<ul>\n  @each((item, i) in items)\n  <li>{{ i }}:{{ item }}</li>\n  @end\n</ul>";
    assert_eq!(render(src, r#"{"items":["a","b"]}"#), "<ul>\n  <li>0:a</li>\n  <li>1:b</li>\n</ul>");

    // Expected values are Edge.js 6.5.1's output.
    let src = "@if(x)\nyes\n@elseif(y)\nmaybe\n@else\nno\n@end\n";
    assert_eq!(render(src, r#"{"x":1}"#), "yes");
    assert_eq!(render(src, r#"{"y":1}"#), "maybe");

    // Same as Edge.js: `~` drops the newline that would precede the next text line.
    let src = "  <title>\n@if(t)~\n{{ t }}\n@end~\n  </title>";
    assert_eq!(render(src, r#"{"t":"Hi"}"#), "  <title>Hi  </title>");

    let src = "@each(x in list)\n{{ x }}\n@else\nempty\n@end";
    assert_eq!(render(src, r#"{"list":[]}"#), "empty");
}

#[test]
fn text_files_keep_their_lines() {
    let src = "/feed.xml\n  type: atom\n@if(on)\n/a  /b\n@end\n# end\n";
    assert_eq!(render(src, r#"{"on":true}"#), "/feed.xml\n  type: atom\n/a  /b\n# end");
    assert_eq!(render(src, "{}"), "/feed.xml\n  type: atom\n# end");
}

#[test]
fn let_and_assign_with_multiline_args() {
    let src = "@let(label = {\n  tip: 'Pro tip',\n  note: 'Note'\n}[type || 'note'] || 'Note')\n@if(force)\n  @assign(label = 'Forced')\n@end\n{{ label }}";
    assert_eq!(render(src, r#"{"type":"tip"}"#), "Pro tip");
    assert_eq!(render(src, r#"{"force":true}"#), "Forced");
}

#[test]
fn includes_share_scope_and_components_isolate() {
    let e = engine(&[
        ("partials/greet", "Hello {{ name }}"),
        ("components/card", "[{{ title }}|{{ name }}|{{{ await $slots.main() }}}|{{{ $slots.foot ? $slots.foot() : '' }}}]"),
    ]);
    let d = data(r#"{"name":"Ada"}"#);
    assert_eq!(e.render_str("t", "@include('partials/greet')", d.clone()).unwrap(), "Hello Ada");
    assert_eq!(e.render_str("t", "@!component('components/card', { title: 'T' })", d.clone()).unwrap(), "[T|||]");
    let src = "@component('components/card', { title: 'T' })\nbody {{ name }}\n@slot('foot')\nF\n@end\n@end";
    // Edge.js gives "[T|undefined|body Ada|F]": it prints undefined values,
    // where ssqch prints nothing.
    assert_eq!(e.render_str("t", src, d).unwrap(), "[T||body Ada|F]");
}

#[test]
fn errors_report_template_and_line() {
    let err = engine(&[]).render_str("page.edge", "line1\n{{ a.b.c }}", data("{}")).unwrap_err();
    let msg = format!("{:#}", err);
    assert!(msg.contains("page.edge:2"), "{}", msg);
    assert!(msg.contains("Cannot read properties of undefined"), "{}", msg);
}

#[test]
fn unknown_at_words_are_text() {
    assert_eq!(render("@media (x) {}\nemail me @ home", "{}"), "@media (x) {}\nemail me @ home");
}

#[test]
fn escapes_like_edge_js() {
    // Edge.js 6.5.1 renders `{{ s }}` with this value as the expected string.
    let s = "a & b < c > d \" e ' f ` g = h";
    assert_eq!(sitesquatch_edge::escape_html(s), "a &amp; b &lt; c &gt; d &quot; e &#x27; f &#x60; g = h");
}

/// Newline and `~` handling, checked against Edge.js 6.5.1: the expected
/// outputs are what `edge.renderRaw(template, { xs: [1, 2] })` returns, with
/// the same `c` component and `p` partial registered.
#[test]
fn whitespace_matches_edge_js() {
    let cases: Vec<String> = serde_json::from_str(include_str!("fixtures/whitespace-cases.json")).unwrap();
    let expected: Vec<String> = serde_json::from_str(include_str!("fixtures/whitespace-expected.json")).unwrap();
    let mut failures = Vec::new();
    for (i, (src, want)) in cases.iter().zip(&expected).enumerate() {
        let e = engine(&[("c", "<{{{ await $slots.main() }}}>[{{{ $slots.foot ? await $slots.foot() : \"\" }}}]"), ("p", "\nP1\nP2\n")]);
        let got = e.render_str("test", src, data(r#"{"xs":[1,2]}"#)).unwrap();
        if &got != want {
            failures.push(format!("case {}: {:?}\n  edge.js: {:?}\n  ssqch:   {:?}", i, src, want, got));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn a_call_reaches_the_filter_when_data_has_the_same_name() {
    // Page data named like a filter shadows it as a value, but calling it means the filter.
    let d = r#"{"upper":"a field","items":["a"]}"#;
    assert_eq!(render("{{ upper }}|{{ upper('x') }}|{{ items.map(i => upper(i)).join('') }}", d), "a field|X|A");
    // A loop variable or `@let` that's a function still wins.
    assert_eq!(render("@let(upper = (s) => s + '!')\n{{ upper('x') }}", "{}"), "x!");
    let err = engine(&[]).render_str("test", "{{ nope('x') }}", data(r#"{"nope":"text"}"#)).unwrap_err();
    assert!(format!("{:#}", err).contains("`nope` is not a function"), "{:#}", err);
}

#[test]
fn an_include_loop_is_named() {
    // Two partials that include each other: the error has the loop once, not a line for each lap.
    let e = engine(&[("a", "A\n@include('b')\n"), ("b", "B\n@include('a')\n")]);
    let error = format!("{:#}", e.render_str("page", "@include('a')\n", data("{}")).unwrap_err());
    assert_eq!(error, "b:2: we've passed this tree before. Include loop: a -> b -> a");
    // A component that uses itself.
    let e = engine(&[("card", "@!component('card')\n")]);
    let error = format!("{:#}", e.render_str("page", "@!component('card')\n", data("{}")).unwrap_err());
    assert_eq!(error, "card:1: we've passed this tree before. Component loop: card -> card");
    // A partial that includes itself a few levels deep (a tree) is fine, and the trail is empty after.
    let e = engine(&[("node", "{{ n }}\n@let(n = n - 1)\n@includeIf(n > 0, 'node')\n")]);
    assert_eq!(e.render_str("page", "@include('node')\n", data(r#"{"n":3}"#)).unwrap().split_whitespace().collect::<String>(), "321");
}
