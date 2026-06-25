const fs = require('fs');
const path = require('path');

// Load both files
const TAGS_PATH = path.join(__dirname, 'data', 'tags.json');
const RULES_PATH = path.join(__dirname, 'data', 'rules.json');

let TAGS = [];
let RULES = [];

try {
    TAGS = JSON.parse(fs.readFileSync(TAGS_PATH, 'utf8'));
    RULES = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
} catch (err) {
    console.error("[TAGGER] Failed to load tag data:", err.message);
}

/**
 * Analyzes an article and returns matched tags
 */
function tagArticle(article) {
    const rawText = `${article.title} ${article.description || ''}`;
    const normalizedText = rawText.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');
    
    const matchedTags = [];

    // FIXED: Removed the accidental space in "TAGS"
    for (const tag of TAGS) { 
        // Get all rules for this tag_id
        const tagRules = RULES.filter(rule => rule.tag_id === tag.id);
        
        let isMatched = false;
        for (const rule of tagRules) {
            if (rule.type === 'keyword') {
                const normalizedPattern = rule.pattern.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');
                if (normalizedText.includes(normalizedPattern)) {
                    isMatched = true;
                    break;
                }
            } else if (rule.type === 'regex') {
                try {
                    const regex = new RegExp(rule.pattern, 'i');
                    if (regex.test(rawText)) {
                        isMatched = true;
                        break;
                    }
                } catch (e) {
                    console.error(`[TAGGER] Invalid regex for tag ${tag.name}: ${rule.pattern}`);
                }
            }
        }

        if (isMatched) {
            matchedTags.push({
                id: tag.id,
                name: tag.name,
                category: tag.category
            });
        }
    }

    return matchedTags;
}

module.exports = { tagArticle };