<template>
	<xn-form-container
		:title="formData.id ? '编辑开课班' : '新增开课班'"
		:width="540"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="学期编码：" name="termCode">
				<a-input v-model:value="formData.termCode" placeholder="例如：2026-2027-1" allow-clear />
			</a-form-item>
			<a-form-item label="课程：" name="courseId">
				<a-select
					v-model:value="formData.courseId"
					:options="courseOptions"
					:field-names="{ label: 'courseName', value: 'id' }"
					placeholder="请选择课程"
					show-search
					option-filter-prop="courseName"
				/>
			</a-form-item>
			<a-form-item label="班级：" name="classId">
				<a-select
					v-model:value="formData.classId"
					:options="classOptions"
					:field-names="{ label: 'className', value: 'id' }"
					placeholder="请选择班级"
					show-search
					option-filter-prop="className"
				/>
			</a-form-item>
			<a-form-item label="任课教师：" name="teacherUserId">
				<a-select
					v-model:value="formData.teacherUserId"
					:options="teacherOptions"
					:field-names="{ label: 'name', value: 'id' }"
					placeholder="请选择任课教师"
					show-search
					option-filter-prop="name"
				/>
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizCourseClassForm">
	import { required } from '@/utils/formRules'
	import bizCourseClassApi from '@/api/biz/bizCourseClassApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import bizClassApi from '@/api/biz/bizClassApi'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const courseOptions = ref([])
	const classOptions = ref([])
	const teacherOptions = ref([])

	const formRules = {
		termCode: [required('请输入学期编码')],
		courseId: [required('请选择课程')],
		classId: [required('请选择班级')],
		teacherUserId: [required('请选择任课教师')]
	}

	const onOpen = (record) => {
		visible.value = true
		formData.value = {}
		if (record) formData.value = Object.assign({}, record)
		bizCourseApi.courseList().then((res) => (courseOptions.value = res || []))
		bizClassApi.clazzList().then((res) => (classOptions.value = res || []))
		bizClassApi.userSelector({ size: 200 }).then((res) => (teacherOptions.value = (res && res.records) || []))
	}

	const onClose = () => {
		visible.value = false
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizCourseClassApi
					.submitForm(formData.value, !!formData.value.id)
					.then(() => {
						visible.value = false
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
