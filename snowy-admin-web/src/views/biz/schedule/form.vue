<template>
	<xn-form-container
		:title="formData.id ? '编辑排课' : '新增排课'"
		:width="560"
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
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="上课开始时间：" name="sessionStart">
						<a-date-picker
							v-model:value="formData.sessionStart"
							class="xn-wd"
							show-time
							value-format="YYYY-MM-DD HH:mm:ss"
							format="YYYY-MM-DD HH:mm:ss"
						/>
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="上课结束时间：" name="sessionEnd">
						<a-date-picker
							v-model:value="formData.sessionEnd"
							class="xn-wd"
							show-time
							value-format="YYYY-MM-DD HH:mm:ss"
							format="YYYY-MM-DD HH:mm:ss"
						/>
					</a-form-item>
				</a-col>
			</a-row>
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="签到有效分钟：" name="expireMinutes">
						<a-input-number v-model:value="formData.expireMinutes" class="xn-wd" :min="1" :max="180" />
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="状态：" name="status">
						<a-radio-group v-model:value="formData.status">
							<a-radio value="active">启用</a-radio>
							<a-radio value="inactive">停用</a-radio>
						</a-radio-group>
					</a-form-item>
				</a-col>
			</a-row>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizScheduleForm">
	import { required } from '@/utils/formRules'
	import bizScheduleApi from '@/api/biz/bizScheduleApi'
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
		teacherUserId: [required('请选择任课教师')],
		sessionStart: [required('请选择上课时间')],
		sessionEnd: [required('请选择下课时间')]
	}

	const onOpen = (record) => {
		visible.value = true
		formData.value = { status: 'active', expireMinutes: 15 }
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
				bizScheduleApi
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
