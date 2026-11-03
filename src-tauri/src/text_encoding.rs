/// Repairs text that was decoded with the wrong legacy encoding.
///
/// The common cases in music tags are:
/// - Windows-1251 bytes interpreted as Latin-1 (`Áðóòàëèòè`);
/// - UTF-8 bytes interpreted as Latin-1 (`Ð•Ð»Ð¸`).
pub fn repair_mojibake(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let suspicious = value
        .chars()
        .filter(|character| (0x80..=0xFF).contains(&(*character as u32)))
        .count();
    let original_cyrillic = value
        .chars()
        .filter(|character| is_cyrillic(*character))
        .count();
    if suspicious < 2 || original_cyrillic > 0 {
        return None;
    }

    let mut bytes = Vec::with_capacity(value.len());
    for character in value.chars() {
        let code = character as u32;
        if code > 0xFF {
            return None;
        }
        bytes.push(code as u8);
    }

    // UTF-8 bytes read as Latin-1 are often valid UTF-8 once reconstructed.
    // Prefer that interpretation when it produces Cyrillic text.
    if let Ok(candidate) = std::str::from_utf8(&bytes) {
        let cyrillic = candidate
            .chars()
            .filter(|character| is_cyrillic(*character))
            .count();
        if cyrillic >= 3
            && candidate != value
            && !candidate.chars().any(is_bad_character)
        {
            return Some(candidate.to_string());
        }
    }

    let (candidate, _, had_errors) = encoding_rs::WINDOWS_1251.decode(&bytes);
    if had_errors {
        return None;
    }
    let candidate = candidate.into_owned();
    if candidate == value || candidate.chars().any(is_bad_character) {
        return None;
    }
    let cyrillic = candidate
        .chars()
        .filter(|character| is_cyrillic(*character))
        .count();
    if cyrillic < 3 {
        return None;
    }
    Some(candidate)
}

fn is_cyrillic(character: char) -> bool {
    ('\u{0400}'..='\u{04FF}').contains(&character)
}

fn is_bad_character(character: char) -> bool {
    character.is_control() || character == '\u{FFFD}'
}

#[cfg(test)]
mod tests {
    use super::*;

    fn latin1_string(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| *byte as char).collect()
    }

    #[test]
    fn repairs_windows_1251_read_as_latin1() {
        let original = latin1_string(&[
            0xC1, 0xF0, 0xF3, 0xF2, 0xE0, 0xEB, 0xE8, 0xF2, 0xE8,
        ]);
        assert_eq!(repair_mojibake(&original), Some("Бруталити".to_string()));
    }

    #[test]
    fn repairs_utf8_read_as_latin1() {
        let expected = "Ели Мясо Мужики";
        let original = latin1_string(expected.as_bytes());
        assert_eq!(repair_mojibake(&original), Some(expected.to_string()));
    }

    #[test]
    fn leaves_valid_latin_text_alone() {
        assert_eq!(repair_mojibake("Mötley Crüe"), None);
        assert_eq!(repair_mojibake("Café"), None);
        assert_eq!(repair_mojibake("Norma Tale"), None);
    }
}
