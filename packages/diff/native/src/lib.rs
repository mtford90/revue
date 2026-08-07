use std::cell::RefCell;
use std::io::Cursor;

use bat::assets::HighlightingAssets;
use napi_derive::napi;
use syntect::easy::HighlightLines;
use syntect::highlighting::{Style, Theme, ThemeSet};
use syntect::parsing::{SyntaxReference, SyntaxSet};

include!(concat!(env!("OUT_DIR"), "/themes.rs"));

#[napi(object)]
pub struct HighlightFile {
    pub path: String,
    pub language: Option<String>,
    pub deletions: Vec<String>,
    pub additions: Vec<String>,
}

#[napi(object)]
pub struct HighlightRequest {
    pub theme: String,
    pub files: Vec<HighlightFile>,
}

#[napi(object)]
pub struct RenderSpan {
    pub text: String,
    pub fg: Option<String>,
}

#[napi(object)]
pub struct HighlightedFile {
    pub deletions: Vec<Vec<RenderSpan>>,
    pub additions: Vec<Vec<RenderSpan>>,
}

#[napi(object)]
pub struct HighlightResponse {
    pub files: Vec<HighlightedFile>,
}

thread_local! {
    // Bat's assets use unsynchronised lazy cells, so retain them once per N-API thread rather than
    // cloning their complete SyntaxSet into a process-wide OnceLock.
    static ASSETS: RefCell<HighlightingAssets> = RefCell::new(HighlightingAssets::from_binary());
}

fn theme(id: &str) -> napi::Result<Theme> {
    let source = THEME_SOURCES
        .iter()
        .find_map(|(name, source)| (*name == id).then_some(*source))
        .ok_or_else(|| napi::Error::from_reason(format!("unknown converted Shiki theme: {id}")))?;
    ThemeSet::load_from_reader(&mut Cursor::new(source.as_bytes()))
        .map_err(|error| napi::Error::from_reason(format!("could not load theme {id}: {error}")))
}

fn syntax_for<'a>(set: &'a SyntaxSet, path: &str, language: Option<&str>) -> &'a SyntaxReference {
    set.find_syntax_by_path(path)
        .or_else(|| language.and_then(|name| set.find_syntax_by_token(name)))
        .unwrap_or_else(|| set.find_syntax_plain_text())
}

fn hex(style: Style) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        style.foreground.r, style.foreground.g, style.foreground.b
    )
}

fn spans(
    highlighter: &mut HighlightLines<'_>,
    line: &str,
    syntaxes: &SyntaxSet,
) -> Vec<RenderSpan> {
    let highlighted = highlighter
        .highlight_line(line, syntaxes)
        .unwrap_or_else(|_| vec![]);
    if highlighted.is_empty() {
        return vec![RenderSpan {
            text: line.to_owned(),
            fg: None,
        }];
    }
    let mut output: Vec<RenderSpan> = Vec::new();
    for (style, text) in highlighted {
        let fg = Some(hex(style));
        if let Some(previous) = output.last_mut().filter(|previous| previous.fg == fg) {
            previous.text.push_str(text);
        } else {
            output.push(RenderSpan {
                text: text.to_owned(),
                fg,
            });
        }
    }
    output
}

fn highlight_side(
    lines: &[String],
    syntax: &SyntaxReference,
    theme: &Theme,
    syntaxes: &SyntaxSet,
) -> Vec<Vec<RenderSpan>> {
    let mut highlighter = HighlightLines::new(syntax, theme);
    lines
        .iter()
        .map(|line| spans(&mut highlighter, line, syntaxes))
        .collect()
}

/// Tokenise ordered diff lines with independent multiline state for each side.
#[napi]
pub fn highlight(request: HighlightRequest) -> napi::Result<HighlightResponse> {
    let theme = theme(&request.theme)?;
    ASSETS.with(|assets| {
        let assets = assets.borrow();
        let syntaxes = assets
            .get_syntax_set()
            .expect("Bat's integrated syntax assets are valid");
        Ok(HighlightResponse {
            files: request
                .files
                .iter()
                .map(|file| {
                    let syntax = syntax_for(syntaxes, &file.path, file.language.as_deref());
                    HighlightedFile {
                        deletions: highlight_side(&file.deletions, syntax, &theme, syntaxes),
                        additions: highlight_side(&file.additions, syntax, &theme, syntaxes),
                    }
                })
                .collect(),
        })
    })
}
