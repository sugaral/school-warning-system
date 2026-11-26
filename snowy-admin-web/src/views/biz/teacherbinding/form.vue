<template>
	<xn-form-container
		title="新增教师授课绑定"
		:width="520"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="筛选学院（辅助过滤课程与教师）：" name="orgId">
				<a-tree-select
					v-model:value="formData.orgId"
					class="xn-wd"
					placeholder="不选则显示数据范围内全部"
					:tree-data="treeData"
					:field-names="{ children: 'children', label: 'name', value: 'id' }"
					:load-data="onLoadData"
					tree-line
					allow-clear
					@change="onOrgChange"
				/>
			</a-form-item>
			<a-form-item label="授课教师：" name="teacherId">
				<a-select
					v-model:value="formData.teacherId"
					:options="teacherOptions"
					:field-names="{ label: 'name', value: 'id' }"
					placeholder="请选择教师"
					show-search
					option-filter-prop="name"
					allow-clear
				/>
			</a-form-item>
			<a-form-item label="课程：" name="courseId">
				<a-select
					v-model:value="formData.courseId"
					:options="courseOptions"
					:field-names="{ label: 'courseName', value: 'id' }"
					placeholder="请选择课程"
					show-search
					option-filter-prop="courseName"
					allow-clear
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
					allow-clear
				/>
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizTeacherBindingForm">
	import { required } from '@/utils/formRules'
	import bizTeacherBindingApi from '@/api/biz/bizTeacherBindingApi'
	import bizClassApi from '@/api/biz/bizClassApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'

	defineProps({
		treeData: { type: Array, default: () => [] },
		onLoadData: { type: Function, default: undefined }
	})
	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const teacherOptions = ref([])
	const courseOptions = ref([])
	const classOptions = ref([])

	const formRules = {
		teacherId: [required('请选择授课教师')],
		courseId: [required('请选择课程')],
		classId: [required('请选择班级')]
	}

	const loadSelectors = (orgId) => {
		const params = orgId ? { orgId } : {}
		bizClassApi.userSelector(params).then((data) => {
			teacherOptions.value = data || []
		})
		bizCourseApi.courseList(params).then((data) => {
			courseOptions.value = data || []
		})
		bizClassApi.clazzList(params).then((data) => {
			classOptions.value = data || []
		})
	}

	const onOrgChange = (orgId) => {
		formData.value.teacherId = undefined
		formData.value.courseId = undefined
		formData.value.classId = undefined
		loadSelectors(orgId)
	}

	const onOpen = (defaultOrgId) => {
		visible.value = true
		formData.value = { orgId: defaultOrgId || undefined }
		loadSelectors(defaultOrgId)
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
				const payload = {
					teacherId: formData.value.teacherId,
					courseId: formData.value.courseId,
					classId: formData.value.classId
				}
				bizTeacherBindingApi
					.teacherBindingAdd(payload)
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
