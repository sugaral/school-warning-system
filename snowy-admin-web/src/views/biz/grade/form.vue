<template>
	<xn-form-container
		:title="formData.id ? '编辑学生成绩' : '录入学生成绩'"
		:width="520"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="学生档案：" name="studentId">
				<a-select
					v-model:value="formData.studentId"
					:options="studentOptions"
					:disabled="!!formData.id"
					placeholder="请输入学号或姓名搜索"
					show-search
					:filter-option="false"
					@search="searchStudents"
					allow-clear
				/>
			</a-form-item>
			<a-form-item label="课程：" name="courseId">
				<a-select
					v-model:value="formData.courseId"
					:options="courseOptions"
					:field-names="{ label: 'courseName', value: 'id' }"
					:disabled="!!formData.id"
					placeholder="请选择课程"
					show-search
					option-filter-prop="courseName"
					allow-clear
				/>
			</a-form-item>
			<a-form-item label="学期编码：" name="termCode">
				<a-input v-model:value="formData.termCode" :disabled="!!formData.id" placeholder="例如 2025-2026-1" allow-clear />
			</a-form-item>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="成绩分数：" name="score">
						<a-input-number v-model:value="formData.score" class="xn-wd" :min="0" :max="150" :precision="2" />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="绩点：" name="gradePoint">
						<a-input-number v-model:value="formData.gradePoint" class="xn-wd" :min="0" :max="5" :precision="2" />
					</a-form-item>
				</a-col>
			</a-row>
			<a-form-item label="及格状态：" name="passStatus">
				<a-select v-model:value="formData.passStatus" placeholder="留空按60分自动判定" allow-clear>
					<a-select-option value="pass">及格 (pass)</a-select-option>
					<a-select-option value="fail">挂科 (fail)</a-select-option>
					<a-select-option value="unknown">未知 (unknown)</a-select-option>
				</a-select>
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizGradeForm">
	import { required } from '@/utils/formRules'
	import bizGradeApi from '@/api/biz/bizGradeApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import bizStudentApi from '@/api/biz/bizStudentApi'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const courseOptions = ref([])
	const studentOptions = ref([])

	const formRules = {
		studentId: [required('请选择学生')],
		courseId: [required('请选择课程')],
		termCode: [required('请输入学期编码')]
	}

	const searchStudents = (searchKey) => {
		bizStudentApi.studentPage({ current: 1, size: 30, searchKey: searchKey || '' }).then((page) => {
			studentOptions.value = (page?.records || []).map((s) => ({
				label: `${s.studentNo} - ${s.name}`,
				value: s.id
			}))
		})
	}

	const onOpen = (record) => {
		visible.value = true
		bizCourseApi.courseList({}).then((data) => {
			courseOptions.value = data || []
		})
		if (record) {
			formData.value = { ...record }
			studentOptions.value = [{ label: `${record.studentNo || ''} - ${record.studentName || record.studentId}`, value: record.studentId }]
		} else {
			formData.value = {}
			searchStudents('')
		}
	}

	const onClose = () => {
		visible.value = false
		formData.value = {}
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				const isEdit = !!formData.value.id
				bizGradeApi
					.submitForm(formData.value, isEdit)
					.then(() => {
						onClose()
						emit('successful')
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>
