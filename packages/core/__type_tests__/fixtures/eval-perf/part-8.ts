import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval35 = evaluate({
  id: "perf-35",
  task: perfTask,
  cases: [
    {
      id: "case-35-free",
      input: { question: "Question 35", tier: "free", index: 35 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-35-pro",
      input: { question: "Detailed question 35", tier: "pro", index: 35 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});

export const eval36 = evaluate({
  id: "perf-36",
  task: perfTask,
  cases: [
    {
      id: "case-36-free",
      input: { question: "Question 36", tier: "free", index: 36 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-36-pro",
      input: { question: "Detailed question 36", tier: "pro", index: 36 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});

export const eval37 = evaluate({
  id: "perf-37",
  task: perfTask,
  cases: [
    {
      id: "case-37-free",
      input: { question: "Question 37", tier: "free", index: 37 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-37-pro",
      input: { question: "Detailed question 37", tier: "pro", index: 37 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});

export const eval38 = evaluate({
  id: "perf-38",
  task: perfTask,
  cases: [
    {
      id: "case-38-free",
      input: { question: "Question 38", tier: "free", index: 38 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-38-pro",
      input: { question: "Detailed question 38", tier: "pro", index: 38 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});

export const eval39 = evaluate({
  id: "perf-39",
  task: perfTask,
  cases: [
    {
      id: "case-39-free",
      input: { question: "Question 39", tier: "free", index: 39 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-39-pro",
      input: { question: "Detailed question 39", tier: "pro", index: 39 },
      call: { locale: "nl" },
      expected: { phrase: "antwoord" },
      trials: 2,
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
    creative: { temperature: 0.8 },
  },
  expect: ({ output, expected, expect, response }) => {
    expect(output.answer).toContain(expected?.phrase ?? "");
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(response.object).toBeDefined();
  },
  gates: {
    passRate: { min: 0.9 },
    latency: { p95Ms: 2_000 },
  },
});
