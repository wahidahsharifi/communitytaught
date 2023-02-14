import mongoose from "mongoose";

import Lesson from "./models/Lesson.js";
import User from "../user/models/User.js";
import LessonProgress from "./models/LessonProgress.js";
import Homework from "../homework/models/Homework.js";

import { getHwProgress } from "../homework/controllers.js";

import redirects from "../../data/redirects.js";
import { createDocument } from "../../utils/formProcessing.js";
import { redirectNotAdmin } from "../user/utils.js";

export const addEditLessonForm = async (req, res) => {
	redirectNotAdmin(req, res);
	const edit = !!req.params.id;
	let lesson = null;
	if (edit) {
		lesson = await Lesson.findById(req.params.id).lean();
		lesson.classes = lesson.classes.map((c) => {
			return {
				...c,
				date: c.date.toISOString().split("T")[0],
			};
		});
	}
	res.render("lesson/addLesson", { edit, lesson });
};

export const addEditLesson = async (req, res) => {
	redirectNotAdmin(req, res);
	try {
		const lessonData = createDocument(req.body);
		const lesson = await Lesson.findByIdAndUpdate(
			req.params.id || mongoose.Types.ObjectId(),
			lessonData,
			{ upsert: true, new: true }
		);

		// if this is a new class, update all users that have current class = null so this is now their current class
		if (!req.params.id) {
			await User.updateMany(
				{ currentClass: null },
				{ currentClass: lesson._id }
			);
		}
		req.session.flash = {
			type: "success",
			message: [`Class ${!!req.params.id ? "updated" : "added"}`],
		};
	} catch (err) {
		console.log(err);
		req.session.flash = {
			type: "error",
			message: [`Class not ${!!req.params.id ? "updated" : "added"}`],
		};
	} finally {
		res.redirect(
			!!req.params.id ? `/class/edit/${req.params.id}` : redirects.addClass
		);
	}
};

export const getAllLessonsProgress = async (userId, lessons) => {
	const lessonProgress = await LessonProgress.find({ user: userId }).lean();
	const lessonsObj = {};
	lessonProgress.forEach((p) => {
		lessonsObj[p.lesson] = {
			watched: p.watched,
			checkedIn: p.checkedIn,
		};
	});
	lessons.forEach((lesson) => {
		const prog = lessonsObj[lesson._id];
		lesson.watched = prog ? !!prog.watched : false;
		lesson.checkedIn = prog ? !!prog.checkedIn : false;
	});
	return lessons;
};

export const allLessons = async (req, res) => {
	let lessons = await Lesson.find().lean().sort({ _id: 1 });
	if (req.isAuthenticated()) {
		lessons = await getAllLessonsProgress(req.user.id, lessons);
	}
	res.render("lesson/allLessons", { lessons });
};

export const getLessonProgress = async (userId, lesson) => {
	const progress = await LessonProgress.findOne({
		user: userId,
		lesson: lesson._id,
	});
	lesson.watched = progress ? progress.watched : false;
	lesson.checkedIn = progress ? progress.checkedIn : false;
	return lesson;
};

export const showLesson = async (req, res) => {
	try {
		let lesson = await Lesson.findOne({
			permalink: req.params.permalink,
		}).lean();
		let next = await Lesson.find({ _id: { $gt: lesson._id } })
			.sort({ _id: 1 })
			.limit(1);
		next = next.length ? next[0].permalink : null;
		let prev = await Lesson.find({ _id: { $lt: lesson._id } })
			.sort({ _id: -1 })
			.limit(1);
		prev = prev.length ? prev[0].permalink : null;
		const classNumbers = lesson.classes.map((c) => c.number);
		let assigned = await Homework.find({
			classNo: { $in: classNumbers },
		})
			.lean()
			.sort({ _id: 1 })
			.populate(["items", "extras"]);
		let due = await Homework.find({ dueNo: { $in: classNumbers } })
			.lean()
			.sort({ _id: 1 })
			.populate(["items", "extras"]);

		if (req.isAuthenticated()) {
			lesson = await getLessonProgress(req.user.id, lesson);
			if (assigned.length)
				assigned = await getHwProgress(req.user.id, assigned);
			if (due.length) due = await getHwProgress(req.user.id, due);
		}
		res.render("lesson/lesson", { lesson, next, prev, assigned, due });
	} catch (err) {
		console.log(err);
		res.redirect(redirects.classes);
	}
};

export const deleteLesson = async (req, res) => {
	if (!req.user?.admin) return res.redirect(redirects.home);
	try {
		const lessonId = req.params.id;
		let next = await Lesson.find({ _id: { $gt: lessonId } })
			.sort({ _id: 1 })
			.limit(1);
		const nextId = next[0] ? next[0]._id : null;
		const res = await User.updateMany(
			{ currentClass: lessonId },
			{ currentClass: nextId }
		);
		await LessonProgress.deleteMany({ lesson: lessonId });
		await Lesson.deleteOne({ _id: lessonId });
	} catch (err) {
		console.log(err);
	} finally {
		res.redirect(redirects.classes);
	}
};

export const toggleWatched = async (req, res) => {
	if (!req.user) return res.status(401).json({ msg: "not logged in" });
	try {
		const userId = req.user.id;
		const lessonId = req.params.id;
		await LessonProgress.toggleWatched(lessonId, userId);
		res.json({ msg: "toggled lesson watched" });
	} catch (err) {
		console.log(err);
		res.status(err.status || 500).json({ error: err.message });
	}
};

export const toggleCheckedIn = async (req, res) => {
	if (!req.user) return res.status(401).json({ msg: "not logged in" });
	try {
		const userId = req.user.id;
		const lessonId = req.params.id;
		await LessonProgress.toggleCheckedIn(lessonId, req.user.id);
		res.json({ msg: "toggled lesson checked in" });
	} catch (err) {
		console.log(err);
		res.status(err.status || 500).json({ error: err.message });
	}
};
