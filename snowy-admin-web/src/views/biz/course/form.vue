<template>
	<xn-form-container
		:title="formData.id ? '编辑课程' : '新增课程'"
		:width="520"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="开课学院：" name="orgId">
				<a-tree-select
					v-model:value="formData.orgId"
					class="xn-wd"
					placeholder="请选择开课学院"
					:tree-data="treeData"
					:field-names="{ children: 'children', label: 'name', value: 'id' }"
					:load-data="onLoadData"
					tree-line
					allow-clear
				/>
			</a-form-item>
			<a-form-item label="课程代码：" name="courseCode">
				<a-input v-model:value="formData.courseCode" placeholder="请输入课程代码" allow-clear />
			</a-form-item>
			<a-form-item label="课程名称：" name="courseName">
				<a-input v-model:value="formData.courseName" placeholder="请输入课程名称" allow-clear />
			</a-form-item>
			<a-form-item label="学分：" name="credit">
				<a-input-number v-model:value="formData.credit" class="xn-wd" :min="0" :max="30" :step="0.5" />
			</a-form-item>
			<a-form-item label="状态：" name="status">
				<a-radio-group v-model:value="formData.status">
					<a-radio value="active">启用</a-radio>
					<a-radio value="inactive">停用</a-radio>
				</a-radio-group>
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizCourseForm">
	import { required } from '@/utils/formRules'
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

	const formRules = {
		orgId: [required('请选择开课学院')],
		courseName: [required('请输入课程名称')]
	}

	const onOpen = (record, orgId) => {
		visible.value = true
		formData.value = { status: 'active', credit: 2.0 }
		if (orgId) formData.value.orgId = orgId
		if (record) formData.value = Object.assign({}, record)
	}

	const onClose = () => {
		visible.value = false
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizCourseApi
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
