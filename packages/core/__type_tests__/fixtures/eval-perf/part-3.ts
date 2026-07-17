import { evaluate } from "../../../src/eval";
import { perfTask } from "./task";

export const eval10 = evaluate({
  id: "perf-10",
  task: perfTask,
  cases: [
    {
      id: "case-10-free",
      input: { question: "Question 10", tier: "free", index: 10 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-10-pro",
      input: { question: "Detailed question 10", tier: "pro", index: 10 },
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

export const eval11 = evaluate({
  id: "perf-11",
  task: perfTask,
  cases: [
    {
      id: "case-11-free",
      input: { question: "Question 11", tier: "free", index: 11 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-11-pro",
      input: { question: "Detailed question 11", tier: "pro", index: 11 },
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

export const eval12 = evaluate({
  id: "perf-12",
  task: perfTask,
  cases: [
    {
      id: "case-12-free",
      input: { question: "Question 12", tier: "free", index: 12 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-12-pro",
      input: { question: "Detailed question 12", tier: "pro", index: 12 },
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

export const eval13 = evaluate({
  id: "perf-13",
  task: perfTask,
  cases: [
    {
      id: "case-13-free",
      input: { question: "Question 13", tier: "free", index: 13 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-13-pro",
      input: { question: "Detailed question 13", tier: "pro", index: 13 },
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

export const eval14 = evaluate({
  id: "perf-14",
  task: perfTask,
  cases: [
    {
      id: "case-14-free",
      input: { question: "Question 14", tier: "free", index: 14 },
      call: { locale: "en" },
      expected: { phrase: "answer" },
    },
    {
      id: "case-14-pro",
      input: { question: "Detailed question 14", tier: "pro", index: 14 },
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
