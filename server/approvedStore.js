const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'data', 'approved-articles.json');

function readApproved() {
    if (!fs.existsSync(FILE_PATH)) {
        fs.writeFileSync(FILE_PATH, JSON.stringify([], null, 2));
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    } catch {
        return [];
    }
}

function writeApproved(articles) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(articles, null, 2));
}

/**
 * Adds a newly approved article to the approved JSON file
 */
function addApprovedArticle(articleData, tags) {
    const approved = readApproved();
    
    // Prevent duplicates if the article is somehow approved twice
    if (approved.find(a => a.id === articleData.id)) {
        return false; 
    }

    // Structure the new entry for the public feed
    const newEntry = {
        id: articleData.id,
        source: articleData.source,
        sourceIcon: articleData.sourceIcon,
        sourceColor: articleData.sourceColor,
        title: articleData.title,
        link: articleData.link,
        published: articleData.published,
        content: articleData.description, // Mapping description to content (See Note below)
        tags: tags,                       // The enriched tags from tagger.js
        approvedAt: new Date().toISOString()
    };

    // Add to the beginning of the array so newest is first
    approved.unshift(newEntry);
    writeApproved(approved);
    return true;
}

function getApprovedArticles() {
    return readApproved();
}

module.exports = { addApprovedArticle, getApprovedArticles };