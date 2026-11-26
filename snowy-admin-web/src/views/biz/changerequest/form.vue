<template>
	<xn-form-container
		title="提交信息变更申请"
		:width="520"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="变更目标类型：" name="targetType">
				<a-select v-model:value="formData.targetType" :options="targetTypeOptions" placeholder="请选择变更类型" />
			</a-form-item>
			<a-form-item label="变更目标ID：" name="targetId">
				<a-input v-model:value="formData.targetId" placeholder="学生档案ID / 教师用户ID / 成绩ID" allow-clear />
			</a-form-item>
			<a-form-item label="变更内容 JSON：" name="changeJson">
				<a-textarea v-model:value="formData.changeJson" :rows="4" placeholder='{"target_class_id":"..."}' />
			</a-form-item>
			<a-form-item label="申请原因：" name="reason">
				<a-textarea v-model:value="formData.reason" :rows="3" placeholder="请输入变更原因" />
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizChangeRequestForm">
	import { required } from '@/utils/formRules'
	import bizChangeRequestApi from '@/api/biz/bizChangeRequestApi'

	const emit = defineEmits({ successful: null })

	const targetTypeOptions = [
		{ label: '学生换班申请 (student_profile_class_change)', value: 'student_profile_class_change' },
		{ label: '学生档案变更 (student_profile)', value: 'student_profile' },
		{ label: '教师授课变更 (teacher_course_binding_change)', value: 'teacher_course_binding_change' },
		{ label: '教师换院变更 (teacher_org_change)', value: 'teacher_org_change' },
		{ label: '成绩变更申请 (grade)', value: 'grade' }
	]

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)

	const formRules = {
		targetType: [required('请选择变更目标类型')],
		targetId: [required('请输入变更目标ID')],
		changeJson: [required('请输入变更内容JSON')]
	}

	const onOpen = () => {
		visible.value = true
		formData.value = { targetType: 'student_profile_class_change', changeJson: '{}' }
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
				bizChangeRequestApi
					.changeRequestAdd(formData.value)
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
