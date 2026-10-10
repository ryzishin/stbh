// scripts/seed.js — seeds initial units, parts, blocks, practice quizzes, a live quiz,
// and flashcards into MongoDB.
//
// Idempotent: existing units/quizzes/flashcards are skipped.
// Run after `npm install` and after the server has booted at least once (which
// creates the indexes via src/config/mongo.js → ensureIndexes).
//
// Usage:
//   npm run db:seed           # seeds starter content
import { getDb, col } from "../src/config/mongo.js";
import { ObjectId } from "mongodb";

async function main() {
  console.log("Seeding STEM Tesla BioHub (MongoDB)…\n");
  await getDb(); // ensures connection + indexes

  // ===== Units =====
  const units = [
    { slug: "genetics-heredity", number: "01", title: "Genetics & Heredity", description: "The foundation: genes, alleles, genotype vs. phenotype.", icon: "🧬", sort_order: 1 },
    { slug: "mendel-laws", number: "02", title: "Mendel's Three Laws", description: "Dominance, segregation, and independent assortment.", icon: "🌱", sort_order: 2 },
    { slug: "non-mendelian", number: "03", title: "Non-Mendelian Inheritance", description: "Incomplete dominance and codominance.", icon: "🌺", sort_order: 3 },
    { slug: "sex-linked", number: "04", title: "Sex-Linked Inheritance", description: "X-linked disorders like hemophilia.", icon: "🧫", sort_order: 4 },
  ];
  const unitsC = await col("units");
  let unitCount = 0;
  for (const u of units) {
    const existing = await unitsC.findOne({ slug: u.slug });
    if (existing) continue;
    await unitsC.insertOne({
      ...u,
      sort_order: u.sort_order,
      updated_at: new Date().toISOString().slice(0, 10),
      created_at: new Date(),
    });
    unitCount++;
  }
  console.log(`✓ ${unitCount} units inserted (${units.length - unitCount} already existed)`);

  // ===== Practice Quizzes =====
  const quizzesC = await col("quizzes");
  const itemsC = await col("quiz_items");
  const optionsC = await col("quiz_options");
  const partsC = await col("parts");
  const blocksC = await col("content_blocks");

  const practiceQuizzes = [
    {
      title: "Genetics Vocabulary",
      description: "Lock in the core terms: gene, allele, genotype, phenotype, dominance.",
      items: [
        {
          type: "multiple_choice", question: "An organism with two identical alleles for a gene is called:",
          points: 1,
          options: [
            { text: "Heterozygous", is_correct: false },
            { text: "Homozygous", is_correct: true },
            { text: "Hemizygous", is_correct: false },
            { text: "Polyzygous", is_correct: false },
          ],
          explanation: "Homo- = same. Two identical alleles (AA or aa).",
        },
        {
          type: "identification", question: "A cross between an unknown genotype and a homozygous recessive is called a ___ cross.",
          correct_answer: "test", points: 2,
          explanation: "A test cross reveals whether a dominant phenotype is homozygous or heterozygous.",
        },
        {
          type: "true_false", question: "A recessive allele is always expressed when present.",
          points: 1,
          options: [
            { text: "True", is_correct: false },
            { text: "False", is_correct: true },
          ],
          explanation: "Recessive alleles are only expressed in the homozygous state.",
        },
      ],
    },
    {
      title: "Mendel's Three Laws",
      description: "Segregation, independent assortment, and the 9:3:3:1 ratio.",
      items: [
        {
          type: "multiple_choice", question: "In a Tt × Tt cross, what is the expected phenotype ratio?",
          points: 1,
          options: [
            { text: "1:1", is_correct: false },
            { text: "3:1", is_correct: true },
            { text: "9:3:3:1", is_correct: false },
            { text: "1:2:1", is_correct: false },
          ],
          explanation: "Phenotype 3 dominant : 1 recessive.",
        },
        {
          type: "identification", question: "Mendel's law stating allele pairs separate during gamete formation is the Law of ___.",
          correct_answer: "segregation", points: 2,
        },
      ],
    },
  ];
  let pqCount = 0;
  for (const q of practiceQuizzes) {
    const existing = await quizzesC.findOne({ title: q.title, kind: "practice" });
    if (existing) continue;
    const r = await quizzesC.insertOne({
      title: q.title,
      description: q.description,
      kind: "practice",
      unit_id: null,
      shuffle_items: true,
      shuffle_options: true,
      time_limit_min: null,
      deadline: null,
      created_at: new Date(),
    });
    const quizId = r.insertedId;
    let order = 1;
    for (const it of q.items) {
      const itemR = await itemsC.insertOne({
        quiz_id: quizId,
        type: it.type,
        question: it.question,
        image_url: null,
        correct_answer: it.correct_answer || null,
        explanation: it.explanation || null,
        points: it.points || 1,
        sort_order: order++,
        created_at: new Date(),
      });
      if (it.options) {
        const opts = it.options.map((o, i) => ({
          item_id: itemR.insertedId,
          text: o.text,
          image_url: null,
          is_correct: o.is_correct,
          sort_order: i,
        }));
        await optionsC.insertMany(opts);
      }
    }
    pqCount++;
  }
  console.log(`✓ ${pqCount} practice quizzes inserted`);

  // ===== Live Quiz =====
  const existingLive = await quizzesC.findOne({ kind: "live" });
  if (!existingLive) {
    const liveR = await quizzesC.insertOne({
      title: "Genetics & Heredity — Unit Test",
      description: "Live hosted unit test. Anti-cheat enabled. Randomized items & options.",
      kind: "live",
      unit_id: null,
      shuffle_items: true,
      shuffle_options: true,
      time_limit_min: 30,
      deadline: null,
      created_at: new Date(),
    });
    const liveQuizId = liveR.insertedId;
    const liveItems = [
      { type: "multiple_choice", question: "Which ratio is the signature of a dihybrid cross (F2)?", points: 2,
        options: [
          { text: "3:1", is_correct: false },
          { text: "1:2:1", is_correct: false },
          { text: "9:3:3:1", is_correct: true },
          { text: "1:1", is_correct: false },
        ] },
      { type: "identification", question: "The cross used to determine an unknown genotype is called a ___ cross.", correct_answer: "test", points: 3 },
      { type: "multiple_choice", question: "Blood type AB is an example of:", points: 2,
        options: [
          { text: "Incomplete dominance", is_correct: false },
          { text: "Codominance", is_correct: true },
          { text: "Epistasis", is_correct: false },
          { text: "Polygenic inheritance", is_correct: false },
        ] },
      { type: "true_false", question: "In incomplete dominance, the heterozygote shows a blended phenotype.", points: 1,
        options: [
          { text: "True", is_correct: true },
          { text: "False", is_correct: false },
        ] },
    ];
    let order = 1;
    for (const it of liveItems) {
      const itemR = await itemsC.insertOne({
        quiz_id: liveQuizId,
        type: it.type,
        question: it.question,
        image_url: null,
        correct_answer: it.correct_answer || null,
        explanation: null,
        points: it.points || 1,
        sort_order: order++,
        created_at: new Date(),
      });
      if (it.options) {
        const opts = it.options.map((o, i) => ({
          item_id: itemR.insertedId,
          text: o.text,
          image_url: null,
          is_correct: o.is_correct,
          sort_order: i,
        }));
        await optionsC.insertMany(opts);
      }
    }
    console.log("✓ Live quiz inserted");
  } else {
    console.log("ℹ Live quiz already exists — skipped");
  }

  // ===== Notes content (a few parts + blocks for the first unit) =====
  const firstUnit = await unitsC.findOne({ slug: "genetics-heredity" });
  if (firstUnit && await partsC.countDocuments({ unit_id: firstUnit._id }) === 0) {
    const partR = await partsC.insertOne({
      unit_id: firstUnit._id,
      title: "Introduction",
      sort_order: 1,
      created_at: new Date(),
    });
    await blocksC.insertMany([
      { part_id: partR.insertedId, kind: "heading", sort_order: 0, text: "What is a gene?", level: 2, items: null, url: null, caption: null, variant: null, created_at: new Date() },
      { part_id: partR.insertedId, kind: "paragraph", sort_order: 1, text: "A gene is a segment of DNA that codes for a specific trait. Different versions of the same gene are called alleles.", items: null, url: null, caption: null, variant: null, level: null, created_at: new Date() },
      { part_id: partR.insertedId, kind: "callout", sort_order: 2, text: "Genotype = the alleles an organism carries. Phenotype = the observable traits.", variant: "info", items: null, url: null, caption: null, level: null, created_at: new Date() },
    ]);
    console.log("✓ Seeded one intro part + 3 blocks under 'Genetics & Heredity'");
  }

  // ===== Flashcards =====
  const fc = await col("flashcards");
  const flashcards = [
    { front: "Gene", back: "A segment of DNA that codes for a specific trait." },
    { front: "Allele", back: "An alternative form of a gene (e.g. T or t)." },
    { front: "Genotype", back: "The specific allele combination an organism carries (e.g. Tt)." },
    { front: "Phenotype", back: "The observable physical expression of the genotype." },
    { front: "Law of Segregation", back: "Allele pairs separate during gamete formation; each gamete gets one allele." },
    { front: "9:3:3:1 ratio", back: "F2 phenotype ratio of a dihybrid cross." },
    { front: "Incomplete dominance", back: "Heterozygote shows a blended phenotype." },
    { front: "Codominance", back: "Both alleles expressed fully in heterozygote (e.g. AB blood type)." },
    { front: "X-linked recessive", back: "Disorders more common in males — they have only one X chromosome." },
    { front: "Carrier", back: "A heterozygous individual who is phenotypically normal but can pass on a recessive allele." },
  ];
  let fcCount = 0;
  for (const f of flashcards) {
    const existing = await fc.findOne({ front: f.front });
    if (existing) continue;
    await fc.insertOne({
      front: f.front,
      back: f.back,
      unit_id: null,
      image_url: null,
      created_at: new Date(),
    });
    fcCount++;
  }
  console.log(`✓ ${fcCount} flashcards inserted`);

  console.log("\n✅ Seed complete. Visit /login to sign in.");
  console.log("   To create your class accounts, prepare a CSV and run:");
  console.log("     node scripts/create-accounts.js path/to/accounts.csv");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
