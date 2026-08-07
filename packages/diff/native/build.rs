use std::{env, fs, path::Path};

fn main() {
    napi_build::setup();
    let manifest = env::var("CARGO_MANIFEST_DIR").expect("cargo manifest directory");
    let theme_dir = Path::new(&manifest).join("themes");
    println!("cargo:rerun-if-changed={}", theme_dir.display());

    let mut themes = fs::read_dir(&theme_dir)
        .expect("generated Shiki theme assets")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "tmTheme")
        })
        .collect::<Vec<_>>();
    themes.sort();
    let items = themes
        .iter()
        .map(|path| {
            let id = path.file_stem().and_then(|stem| stem.to_str()).expect("theme id");
            format!("(\"{id}\", include_str!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/themes/{id}.tmTheme\")))")
        })
        .collect::<Vec<_>>()
        .join(",\n");
    fs::write(
        Path::new(&env::var("OUT_DIR").expect("cargo output directory")).join("themes.rs"),
        format!("pub static THEME_SOURCES: &[(&str, &str)] = &[{items}];\n"),
    )
    .expect("generated theme source map");
}
